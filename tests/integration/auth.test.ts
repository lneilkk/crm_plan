/**
 * T2-1 로그인 — 잠금·해제, 세션, 비밀번호 평문이 어디에도 남지 않음.
 * T1-4 마지막 기준 — 시드한 계정으로 바로 로그인할 수 있음.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";
import { GET as meRoute } from "@/app/api/auth/me/route";
import { GET as staffListRoute } from "@/app/api/staff/route";
import { POST as unlockRoute } from "@/app/api/staff/[id]/unlock/route";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session-cookie";
import { hashPassword } from "@/server/auth/password";
import { hashSessionToken } from "@/server/auth/session";
import { unlockStaffByLoginId } from "@/server/auth/unlock";
import { seed } from "../../prisma/seed";
import { callRoute, loginAs } from "./helpers/api";
import { createStaff, db, resetDb } from "./helpers";

// 가짜 비밀번호. 실제 .env의 값과 무관하다.
const PASSWORD = "auth-test-password-0000";
const WRONG = "auth-test-wrong-password";

beforeEach(resetDb);

async function staffWithPassword(overrides: Parameters<typeof createStaff>[0] = {}) {
  return createStaff({ passwordHash: await hashPassword(PASSWORD), ...overrides });
}

function login(loginId: string, password: string) {
  return callRoute(loginRoute, { method: "POST", url: "/api/auth/login", body: { loginId, password } });
}

function cookieFrom(headers: Headers): string {
  const setCookie = headers.get("set-cookie") ?? "";
  return setCookie.split(";")[0];
}

async function loginAudits() {
  return db.auditLog.findMany({ where: { action: "AUTH_LOGIN" }, orderBy: { createdAt: "asc" } });
}

describe("로그인 성공", () => {
  it("httpOnly 세션 쿠키를 주고, DB에는 토큰의 해시만 둔다", async () => {
    const staff = await staffWithPassword({ role: "FRONT", name: "가상프론트" });
    const res = await login(staff.loginId, PASSWORD);

    expect(res.status).toBe(200);
    expect(res.json.staff).toMatchObject({ id: staff.id, role: "FRONT", loginId: staff.loginId });
    expect(res.json.staff.navSections).toEqual(["board", "calendar", "patients"]);

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=[A-Za-z0-9_-]{43};`));
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    const token = cookieFrom(res.headers).split("=")[1];
    expect(JSON.stringify(res.json)).not.toContain(token);

    const sessions = await db.session.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].staffId).toBe(staff.id);
    expect(sessions[0].tokenHash).toBe(hashSessionToken(token));
    expect(sessions[0].tokenHash).not.toContain(token);
    expect(sessions[0].expiresAt.getTime() - sessions[0].createdAt.getTime()).toBe(12 * 60 * 60 * 1000);

    const after = await db.staff.findUniqueOrThrow({ where: { id: staff.id } });
    expect(after.lastLoginAt).not.toBeNull();

    const audits = await loginAudits();
    expect(audits.map((a) => [a.staffId, a.result])).toEqual([[staff.id, "SUCCESS"]]);

    const me = await callRoute(meRoute, { url: "/api/auth/me", cookie: cookieFrom(res.headers) });
    expect(me.status).toBe(200);
    expect(me.json).toEqual({
      id: staff.id,
      name: "가상프론트",
      role: "FRONT",
      loginId: staff.loginId,
      navSections: ["board", "calendar", "patients"],
    });
  });

  it("맞는 비밀번호는 연속 실패 횟수를 0으로 되돌린다", async () => {
    const staff = await staffWithPassword();
    await login(staff.loginId, WRONG);
    await login(staff.loginId, WRONG);
    expect((await db.staff.findUniqueOrThrow({ where: { id: staff.id } })).failedLoginCount).toBe(2);

    expect((await login(staff.loginId, PASSWORD)).status).toBe(200);
    expect((await db.staff.findUniqueOrThrow({ where: { id: staff.id } })).failedLoginCount).toBe(0);
  });
});

describe("로그인 실패와 잠금", () => {
  it("틀린 비밀번호는 401과 일반 문구, 실패 횟수 +1", async () => {
    const staff = await staffWithPassword();
    const res = await login(staff.loginId, WRONG);

    expect(res.status).toBe(401);
    expect(res.json.error).toEqual({ code: "INVALID_CREDENTIALS", message: "아이디 또는 비밀번호가 올바르지 않습니다." });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect((await db.staff.findUniqueOrThrow({ where: { id: staff.id } })).failedLoginCount).toBe(1);
    expect(await db.session.count()).toBe(0);

    const audits = await loginAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ staffId: staff.id, result: "FAILED" });
    expect(audits[0].detail).toEqual({ reason: "BAD_PASSWORD", failedCount: 1, locked: false });
  });

  it("없는 아이디와 비활성 계정도 같은 문구로 거부한다", async () => {
    const unknown = await login("no-such-staff", PASSWORD);
    const inactive = await staffWithPassword({ isActive: false });
    const inactiveRes = await login(inactive.loginId, PASSWORD);

    for (const res of [unknown, inactiveRes]) {
      expect(res.status).toBe(401);
      expect(res.json.error.code).toBe("INVALID_CREDENTIALS");
    }
    expect(await db.session.count()).toBe(0);
    const audits = await loginAudits();
    expect(audits.map((a) => [a.staffId, a.result, (a.detail as { reason: string }).reason])).toEqual([
      [null, "FAILED", "UNKNOWN_LOGIN_ID"],
      [inactive.id, "FAILED", "INACTIVE"],
    ]);
  });

  it("5번 틀리면 잠기고(423), 그 뒤에는 맞는 비밀번호도 거부한다", async () => {
    const staff = await staffWithPassword();
    for (let i = 1; i <= 4; i += 1) {
      expect((await login(staff.loginId, WRONG)).status).toBe(401);
    }
    const fifth = await login(staff.loginId, WRONG);
    expect(fifth.status).toBe(423);
    expect(fifth.json.error).toEqual({ code: "ACCOUNT_LOCKED", message: "계정이 잠겼습니다. 관리자에게 해제를 요청하세요." });

    const locked = await db.staff.findUniqueOrThrow({ where: { id: staff.id } });
    expect(locked.failedLoginCount).toBe(5);
    expect(locked.lockedAt).not.toBeNull();

    const correct = await login(staff.loginId, PASSWORD);
    expect(correct.status).toBe(423);
    expect(correct.headers.get("set-cookie")).toBeNull();
    expect(await db.session.count()).toBe(0);
    // 잠긴 뒤의 시도는 횟수를 더 올리지 않는다.
    expect((await db.staff.findUniqueOrThrow({ where: { id: staff.id } })).failedLoginCount).toBe(5);

    const audits = await loginAudits();
    expect(audits.at(-1)).toMatchObject({ staffId: staff.id, result: "DENIED", detail: { reason: "LOCKED" } });
  });

  it("동시에 틀린 비밀번호를 10번 보내도 횟수가 빠짐없이 올라가고 잠긴다", async () => {
    const staff = await staffWithPassword();
    const results = await Promise.all(Array.from({ length: 10 }, () => login(staff.loginId, WRONG)));
    const after = await db.staff.findUniqueOrThrow({ where: { id: staff.id } });

    expect(after.lockedAt).not.toBeNull();
    // 잠기기 전에 읽은 요청만 횟수를 올린다 — 최소 5, 요청 수 이하
    expect(after.failedLoginCount).toBeGreaterThanOrEqual(5);
    expect(after.failedLoginCount).toBeLessThanOrEqual(10);
    expect(results.filter((r) => r.status === 401).length).toBeLessThanOrEqual(4);
    expect(results.every((r) => r.status === 401 || r.status === 423)).toBe(true);
  });

  it("빈 입력은 400이고 값을 되돌려 주지 않는다", async () => {
    const res = await callRoute(loginRoute, { method: "POST", url: "/api/auth/login", body: { loginId: "", password: PASSWORD } });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("VALIDATION_FAILED");
    expect(res.text).not.toContain(PASSWORD);
  });
});

describe("잠금 해제", () => {
  async function lockedStaff() {
    return staffWithPassword({ failedLoginCount: 5, lockedAt: new Date() });
  }

  it("관리자가 해제하면 다시 로그인할 수 있다", async () => {
    const staff = await lockedStaff();
    const admin = await loginAs("ADMIN");

    const res = await callRoute(unlockRoute, {
      method: "POST",
      url: `/api/staff/${staff.id}/unlock`,
      cookie: admin.cookie,
      params: { id: staff.id },
    });
    expect(res.status).toBe(200);

    const after = await db.staff.findUniqueOrThrow({ where: { id: staff.id } });
    expect(after.lockedAt).toBeNull();
    expect(after.failedLoginCount).toBe(0);

    const audits = await db.auditLog.findMany({ where: { action: "STAFF_UNLOCK" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ staffId: admin.staff.id, result: "SUCCESS", patientId: null });
    expect(audits[0].detail).toEqual({ targetStaffId: staff.id, patientCount: 0 });

    expect((await login(staff.loginId, PASSWORD)).status).toBe(200);
  });

  it("프론트는 해제할 수 없다 — 403과 DENIED 감사 행", async () => {
    const staff = await lockedStaff();
    const front = await loginAs("FRONT");

    const res = await callRoute(unlockRoute, {
      method: "POST",
      url: `/api/staff/${staff.id}/unlock`,
      cookie: front.cookie,
      params: { id: staff.id },
    });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe("FORBIDDEN");
    expect((await db.staff.findUniqueOrThrow({ where: { id: staff.id } })).lockedAt).not.toBeNull();

    const audits = await db.auditLog.findMany({ where: { action: "STAFF_UNLOCK" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ staffId: front.staff.id, result: "DENIED" });
    expect(audits[0].detail).toMatchObject({ permission: "staff.manage", method: "POST" });
  });

  it("운영자 명령(scripts/ops/staff-unlock.ts)은 아이디로 풀고 감사 행을 같은 트랜잭션에 남긴다", async () => {
    const staff = await lockedStaff();
    const result = await unlockStaffByLoginId(db, staff.loginId);
    expect(result).toEqual({ ok: true, staffId: staff.id, wasLocked: true });
    const after = await db.staff.findUniqueOrThrow({ where: { id: staff.id } });
    expect(after.lockedAt).toBeNull();
    expect(after.failedLoginCount).toBe(0);
    const audits = await db.auditLog.findMany({ where: { action: "STAFF_UNLOCK" } });
    expect(audits.map((a) => [a.staffId, a.result, a.detail])).toEqual([
      [null, "SUCCESS", { targetStaffId: staff.id, via: "CLI", wasLocked: true }],
    ]);
    expect((await login(staff.loginId, PASSWORD)).status).toBe(200);

    expect(await unlockStaffByLoginId(db, "no-such-login-id")).toEqual({ ok: false, reason: "NOT_FOUND" });
    expect(await db.auditLog.count({ where: { action: "STAFF_UNLOCK" } })).toBe(1);
  });

  it("없는 직원 id는 404", async () => {
    const admin = await loginAs("ADMIN");
    const id = "01900000-0000-7000-8000-000000000000";
    const res = await callRoute(unlockRoute, { method: "POST", url: `/api/staff/${id}/unlock`, cookie: admin.cookie, params: { id } });
    expect(res.status).toBe(404);
  });
});

describe("세션", () => {
  it("로그아웃하면 세션이 무효가 되고 쿠키를 지운다", async () => {
    const front = await loginAs("FRONT");
    expect((await callRoute(meRoute, { cookie: front.cookie })).status).toBe(200);

    const res = await callRoute(logoutRoute, { method: "POST", url: "/api/auth/logout", cookie: front.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=;.*Max-Age=0`));
    expect((await db.session.findUniqueOrThrow({ where: { id: front.sessionId } })).revokedAt).not.toBeNull();

    const me = await callRoute(meRoute, { cookie: front.cookie });
    expect(me.status).toBe(401);
    expect(me.json.error.code).toBe("UNAUTHENTICATED");

    const audits = await db.auditLog.findMany({ where: { action: "AUTH_LOGOUT" } });
    expect(audits.map((a) => [a.staffId, a.result])).toEqual([[front.staff.id, "SUCCESS"]]);
  });

  it("만료된 세션은 401", async () => {
    const front = await loginAs("FRONT");
    await db.session.update({ where: { id: front.sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await callRoute(meRoute, { cookie: front.cookie })).status).toBe(401);
  });

  it("비활성화되면 기존 세션도 401", async () => {
    const inactive = await loginAs("FRONT");
    await db.staff.update({ where: { id: inactive.staff.id }, data: { isActive: false } });
    expect((await callRoute(meRoute, { cookie: inactive.cookie })).status).toBe(401);
  });

  it("잠금은 새 로그인만 막고, 로그인 중인 세션은 끊지 않는다 — 남이 5번 틀려 관리자를 쫓아낼 수 없다", async () => {
    const admin = await staffWithPassword({ role: "ADMIN" });
    const first = await login(admin.loginId, PASSWORD);
    expect(first.status).toBe(200);
    const cookie = cookieFrom(first.headers);

    for (let i = 0; i < 5; i += 1) await login(admin.loginId, WRONG);
    expect((await db.staff.findUniqueOrThrow({ where: { id: admin.id } })).lockedAt).not.toBeNull();

    // 이미 로그인한 관리자는 계속 일할 수 있고, 잠긴 다른 계정을 풀 수도 있다.
    expect((await callRoute(meRoute, { cookie })).status).toBe(200);
    const res = await callRoute(unlockRoute, {
      method: "POST",
      url: `/api/staff/${admin.id}/unlock`,
      cookie,
      params: { id: admin.id },
    });
    expect(res.status).toBe(200);
    // 새 로그인은 잠금 동안 막혔다가, 해제 뒤 된다.
    expect((await login(admin.loginId, PASSWORD)).status).toBe(200);
  });

  it("다시 로그인하면 쿠키에 있던 이전 세션(공용 PC의 앞 직원)을 끊는다", async () => {
    const a = await loginAs("FRONT");
    const b = await staffWithPassword({ role: "FRONT" });
    const res = await callRoute(loginRoute, {
      method: "POST",
      url: "/api/auth/login",
      cookie: a.cookie,
      body: { loginId: b.loginId, password: PASSWORD },
    });
    expect(res.status).toBe(200);
    expect((await callRoute(meRoute, { cookie: a.cookie })).status).toBe(401);
    expect((await db.session.findUniqueOrThrow({ where: { id: a.sessionId } })).revokedAt).not.toBeNull();
    expect((await callRoute(meRoute, { cookie: cookieFrom(res.headers) })).status).toBe(200);
    const audits = await loginAudits();
    expect(audits.map((x) => [x.staffId, x.result, x.detail])).toEqual([[b.id, "SUCCESS", { previousSessionRevoked: true }]]);
  });

  it("로그인에 실패하면 쿠키에 있던 세션은 그대로 둔다", async () => {
    const a = await loginAs("FRONT");
    const b = await staffWithPassword({ role: "FRONT" });
    const res = await callRoute(loginRoute, {
      method: "POST",
      url: "/api/auth/login",
      cookie: a.cookie,
      body: { loginId: b.loginId, password: WRONG },
    });
    expect(res.status).toBe(401);
    expect((await callRoute(meRoute, { cookie: a.cookie })).status).toBe(200);
  });

  it("모르는 토큰·깨진 쿠키는 401", async () => {
    expect((await callRoute(meRoute, { cookie: `${SESSION_COOKIE_NAME}=${"A".repeat(43)}` })).status).toBe(401);
    expect((await callRoute(meRoute, { cookie: `${SESSION_COOKIE_NAME}=not-a-token` })).status).toBe(401);
  });

  it("last_seen_at은 1분이 지난 뒤에만 갱신한다", async () => {
    const front = await loginAs("FRONT");
    const recent = new Date(Date.now() - 30_000);
    await db.session.update({ where: { id: front.sessionId }, data: { lastSeenAt: recent } });
    await callRoute(meRoute, { cookie: front.cookie });
    expect((await db.session.findUniqueOrThrow({ where: { id: front.sessionId } })).lastSeenAt).toEqual(recent);

    const old = new Date(Date.now() - 120_000);
    await db.session.update({ where: { id: front.sessionId }, data: { lastSeenAt: old } });
    await callRoute(meRoute, { cookie: front.cookie });
    const touched = (await db.session.findUniqueOrThrow({ where: { id: front.sessionId } })).lastSeenAt;
    expect(touched.getTime()).toBeGreaterThan(old.getTime() + 60_000);
  });
});

describe("직원 목록 (드롭다운용)", () => {
  it("재직 중인 직원의 id·이름·역할만, 역할로 거를 수 있다", async () => {
    const front = await loginAs("FRONT", { name: "가상프론트" });
    const doctor = await createStaff({ role: "DOCTOR", name: "가상의사" });
    await createStaff({ role: "DOCTOR", name: "가상퇴사의사", isActive: false });

    const all = await callRoute(staffListRoute, { url: "/api/staff", cookie: front.cookie });
    expect(all.status).toBe(200);
    expect(all.json.staff).toHaveLength(2);
    for (const row of all.json.staff) expect(Object.keys(row).sort()).toEqual(["id", "name", "role"]);

    const doctors = await callRoute(staffListRoute, { url: "/api/staff?role=DOCTOR", cookie: front.cookie });
    expect(doctors.json.staff).toEqual([{ id: doctor.id, name: "가상의사", role: "DOCTOR" }]);

    expect((await callRoute(staffListRoute, { url: "/api/staff?role=OWNER", cookie: front.cookie })).status).toBe(400);
  });
});

describe("T1-4 — 시드 계정으로 바로 로그인", () => {
  it("시드가 만든 모든 계정이 SEED_STAFF_PASSWORD로 로그인된다", async () => {
    const seedPassword = "seed-login-test-password-0000";
    await seed(db, { FAKE_DATA_ALLOWED: "true", SEED_STAFF_PASSWORD: seedPassword });

    for (const loginId of ["admin", "doctor1", "doctor2", "front1", "counselor1"]) {
      const res = await login(loginId, seedPassword);
      expect(res.status, loginId).toBe(200);
      expect(res.json.staff.loginId).toBe(loginId);
    }
    expect(await db.session.count()).toBe(5);
  });
});

describe("비밀번호 평문이 어디에도 남지 않는다", () => {
  const output: string[] = [];

  beforeEach(() => {
    output.length = 0;
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        output.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("실패·성공·잠금 로그인 뒤 감사 로그·세션·직원 행·로그 출력·응답에 비밀번호가 없다", async () => {
    const secret = "Zq9-distinctive-pw-7731";
    const wrongSecret = "Wx4-distinctive-wrong-8842";
    const staff = await createStaff({ passwordHash: await hashPassword(secret) });

    const responses = [
      await login(staff.loginId, wrongSecret),
      await login(staff.loginId, secret),
      await login("no-such-staff", wrongSecret),
      await callRoute(loginRoute, { method: "POST", url: "/api/auth/login", body: { loginId: staff.loginId, password: 42 } }),
      await callRoute(loginRoute, { method: "POST", url: "/api/auth/login", body: `{"password":"${secret}"` }),
    ];
    for (let i = 0; i < 5; i += 1) responses.push(await login(staff.loginId, wrongSecret));
    responses.push(await login(staff.loginId, secret)); // 잠긴 뒤

    const stored = JSON.stringify({
      audits: await db.auditLog.findMany(),
      sessions: await db.session.findMany(),
      staff: await db.staff.findMany(),
    });
    expect(stored).toContain("AUTH_LOGIN"); // 실제로 행이 있다
    const responseText = responses.map((r) => r.text + JSON.stringify([...r.headers])).join("\n");
    for (const text of [stored, output.join("\n"), responseText]) {
      expect(text).not.toContain(secret);
      expect(text).not.toContain(wrongSecret);
    }
  });
});
