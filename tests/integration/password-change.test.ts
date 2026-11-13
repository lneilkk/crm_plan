/**
 * F-1 비밀번호 변경 — 로그인한 직원이 자기 비밀번호를 바꾼다.
 * 현재 비밀번호 확인, 규칙 검사, 다른 세션 끊기, 틀리면 로그인 실패와 같이 세어 5회에 잠금,
 * 비밀번호 평문이 어디에도 남지 않음, 감사 로그.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { GET as meRoute } from "@/app/api/auth/me/route";
import { POST as passwordRoute } from "@/app/api/auth/password/route";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session-cookie";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";
import { callRoute } from "./helpers/api";
import { createStaff, db, resetDb } from "./helpers";

// 테스트 전용 가짜 값
const OLD_PW = "Old-pw-test-0001";
const NEW_PW = "New-pw-test-0002";
const WRONG_PW = "Wrong-pw-test-0003";

beforeEach(resetDb);

async function setup(overrides: Parameters<typeof createStaff>[0] = {}) {
  const staff = await createStaff({ loginId: "pwtest", passwordHash: await hashPassword(OLD_PW), ...overrides });
  const current = await createSession(staff.id, { ip: null, userAgent: "vitest", now: new Date() });
  return { staff, current, cookie: `${SESSION_COOKIE_NAME}=${current.token}` };
}

function change(cookie: string | undefined, body: unknown) {
  return callRoute(passwordRoute, { method: "POST", url: "/api/auth/password", cookie, body });
}

function login(loginId: string, pw: string) {
  return callRoute(loginRoute, { method: "POST", url: "/api/auth/login", body: { loginId, password: pw } });
}

async function storedHash(id: string) {
  return (await db.staff.findUniqueOrThrow({ where: { id } })).passwordHash;
}

describe("POST /api/auth/password", () => {
  it("현재 비밀번호가 맞고 새 비밀번호가 규칙에 맞으면 바뀐다: 새 비밀번호로 로그인되고 옛 비밀번호는 안 된다", async () => {
    const { staff, cookie } = await setup();
    const res = await change(cookie, { currentPassword: OLD_PW, newPassword: NEW_PW });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, otherSessionsRevoked: 0 });

    expect(await verifyPassword(await storedHash(staff.id), NEW_PW)).toBe(true);
    expect((await login(staff.loginId, NEW_PW)).status).toBe(200);
    expect((await login(staff.loginId, OLD_PW)).status).toBe(401);

    const audits = await db.auditLog.findMany({ where: { action: "STAFF_PASSWORD_CHANGE" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ staffId: staff.id, result: "SUCCESS", patientId: null });
  });

  it("바꾸면 이 직원의 다른 세션은 끊기고 지금 세션은 그대로다. 다른 직원의 세션은 건드리지 않는다", async () => {
    const { staff, cookie } = await setup();
    const other = await createSession(staff.id, { ip: null, userAgent: "other-pc", now: new Date() });
    const someoneElse = await createStaff();
    const theirs = await createSession(someoneElse.id, { ip: null, userAgent: "x", now: new Date() });

    const res = await change(cookie, { currentPassword: OLD_PW, newPassword: NEW_PW });
    expect(res.json.otherSessionsRevoked).toBe(1);

    expect((await callRoute(meRoute, { cookie })).status).toBe(200);
    expect((await callRoute(meRoute, { cookie: `${SESSION_COOKIE_NAME}=${other.token}` })).status).toBe(401);
    expect((await callRoute(meRoute, { cookie: `${SESSION_COOKIE_NAME}=${theirs.token}` })).status).toBe(200);
  });

  it("현재 비밀번호가 틀리면 400, 비밀번호는 그대로이고 실패 횟수가 1 오르며 감사 로그는 FAILED", async () => {
    const { staff, cookie } = await setup();
    const before = await storedHash(staff.id);
    const res = await change(cookie, { currentPassword: WRONG_PW, newPassword: NEW_PW });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("INVALID_CURRENT_PASSWORD");
    expect(await storedHash(staff.id)).toBe(before);
    expect((await db.staff.findUniqueOrThrow({ where: { id: staff.id } })).failedLoginCount).toBe(1);
    const audits = await db.auditLog.findMany({ where: { action: "STAFF_PASSWORD_CHANGE" } });
    expect(audits).toHaveLength(1);
    expect(audits[0].result).toBe("FAILED");
    expect(audits[0].detail).toMatchObject({ errorCode: "INVALID_CURRENT_PASSWORD" });
  });

  it("현재 비밀번호를 5번 틀리면 계정이 잠긴다(새 로그인 불가). 지금 세션은 유지되고 더 시도해도 바뀌지 않는다", async () => {
    const { staff, cookie } = await setup();
    for (let i = 0; i < 5; i += 1) {
      expect((await change(cookie, { currentPassword: `Wrong-pw-test-${i}0`, newPassword: NEW_PW })).status).toBe(400);
    }
    const row = await db.staff.findUniqueOrThrow({ where: { id: staff.id } });
    expect(row.lockedAt).not.toBeNull();
    expect((await login(staff.loginId, OLD_PW)).status).toBe(423);
    expect((await callRoute(meRoute, { cookie })).status).toBe(200);

    // 잠긴 뒤에는 맞는 현재 비밀번호로도 바꿀 수 없다(대입 방지). 관리자가 잠금을 풀어야 한다.
    const res = await change(cookie, { currentPassword: OLD_PW, newPassword: NEW_PW });
    expect(res.status).toBe(423);
    expect(res.json.error.code).toBe("ACCOUNT_LOCKED");
    expect(await verifyPassword(await storedHash(staff.id), OLD_PW)).toBe(true);
  });

  it("맞게 바꾸면 그전까지의 실패 횟수가 지워진다", async () => {
    const { staff, cookie } = await setup();
    await change(cookie, { currentPassword: WRONG_PW, newPassword: NEW_PW });
    await change(cookie, { currentPassword: OLD_PW, newPassword: NEW_PW });
    expect((await db.staff.findUniqueOrThrow({ where: { id: staff.id } })).failedLoginCount).toBe(0);
  });

  it("새 비밀번호가 규칙에 맞지 않으면 400 WEAK_PASSWORD와 규칙 코드만 돌려주고 바꾸지 않는다", async () => {
    const { staff, cookie } = await setup();
    const before = await storedHash(staff.id);
    for (const [weak, rule] of [
      ["short1", "TOO_SHORT"],
      ["onlylowercaseletters", "TOO_FEW_CLASSES"],
      ["Pwtest-1234", "CONTAINS_LOGIN_ID"],
    ] as const) {
      const res = await change(cookie, { currentPassword: OLD_PW, newPassword: weak });
      expect(res.status).toBe(400);
      expect(res.json.error.code).toBe("WEAK_PASSWORD");
      expect(res.json.error.rules).toContain(rule);
      expect(res.text).not.toContain(weak);
    }
    expect(await storedHash(staff.id)).toBe(before);
    // 규칙 위반은 현재 비밀번호 실패로 세지 않는다
    expect((await db.staff.findUniqueOrThrow({ where: { id: staff.id } })).failedLoginCount).toBe(0);
  });

  it("새 비밀번호가 지금과 같으면 400 SAME_AS_CURRENT", async () => {
    const { cookie } = await setup();
    const res = await change(cookie, { currentPassword: OLD_PW, newPassword: OLD_PW });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("SAME_AS_CURRENT");
  });

  it("로그인하지 않으면 401, 입력이 빠지면 400(필드 경로만)", async () => {
    expect((await change(undefined, { currentPassword: OLD_PW, newPassword: NEW_PW })).status).toBe(401);
    const { cookie } = await setup();
    const res = await change(cookie, { currentPassword: OLD_PW });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("VALIDATION_FAILED");
    expect(res.text).not.toContain(OLD_PW);
  });

  it("다른 출처(Origin)에서 온 요청은 거부한다", async () => {
    const { staff, cookie } = await setup();
    const before = await storedHash(staff.id);
    const res = await callRoute(passwordRoute, {
      method: "POST",
      url: "/api/auth/password",
      cookie,
      body: { currentPassword: OLD_PW, newPassword: NEW_PW },
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
    expect(await storedHash(staff.id)).toBe(before);
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

  it("성공·실패·규칙 위반 뒤 감사 로그·직원 행·세션·로그 출력·응답에 현재·새 비밀번호가 없다", async () => {
    const { cookie } = await setup();
    const tooWeak = "Weak-test-9";
    const wrongOne = "Wrong-pw-test-0005";
    const responses = [
      await change(cookie, { currentPassword: wrongOne, newPassword: NEW_PW }),
      await change(cookie, { currentPassword: OLD_PW, newPassword: tooWeak }),
      await change(cookie, { currentPassword: OLD_PW, newPassword: 12345 }),
      await change(cookie, { currentPassword: OLD_PW, newPassword: NEW_PW }),
    ];
    const stored = JSON.stringify({
      audits: await db.auditLog.findMany(),
      staff: await db.staff.findMany(),
      sessions: await db.session.findMany(),
    });
    expect(stored).toContain("STAFF_PASSWORD_CHANGE");
    const responseText = responses.map((r) => r.text + JSON.stringify([...r.headers])).join("\n");
    for (const text of [stored, output.join("\n"), responseText]) {
      for (const value of [OLD_PW, NEW_PW, tooWeak, wrongOne]) expect(text).not.toContain(value);
    }
  });
});
