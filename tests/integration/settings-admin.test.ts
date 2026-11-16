/**
 * F-14 [편집] 탭 — 직원 계정 관리(T2-5 일부), 체어·열 묶음, 진료시간·기준(T4-4). 모두 관리자만.
 */
import { randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { GET as meRoute } from "@/app/api/auth/me/route";
import { GET as boardRoute } from "@/app/api/board/route";
import { PUT as chairsRoute } from "@/app/api/settings/chairs/route";
import { PUT as clinicRoute } from "@/app/api/settings/clinic/route";
import { GET as accountsRoute } from "@/app/api/staff/accounts/route";
import { PATCH as staffPatch } from "@/app/api/staff/[id]/route";
import { POST as staffCreate } from "@/app/api/staff/route";
import { DEFAULT_CLINIC_SETTINGS } from "@/lib/domain/clinic";
import { addDays, kstDateKey, kstDateTime } from "@/lib/time/kst";
import { callRoute, loginAs } from "./helpers/api";
import { createAppointment, db, resetDb } from "./helpers";

beforeAll(() => {
  process.env.PII_ENC_KEY = randomBytes(32).toString("base64");
  process.env.PII_HMAC_KEY = randomBytes(32).toString("base64");
});

beforeEach(async () => {
  await resetDb();
  await db.clinicSetting.create({
    data: {
      id: 1,
      lateToleranceMin: DEFAULT_CLINIC_SETTINGS.lateToleranceMin,
      noShowGraceMin: DEFAULT_CLINIC_SETTINGS.noShowGraceMin,
      businessHours: DEFAULT_CLINIC_SETTINGS.businessHours,
      chairs: DEFAULT_CLINIC_SETTINGS.chairs,
      treatmentItems: DEFAULT_CLINIC_SETTINGS.treatmentItems,
      treatmentItemMeta: DEFAULT_CLINIC_SETTINGS.treatmentItemMeta,
    },
  });
});

const PW = "Nurse-pw-test-01";

function create(cookie: string, body: unknown) {
  return callRoute(staffCreate, { method: "POST", url: "/api/staff", cookie, body });
}
function patch(cookie: string, id: string, body: unknown) {
  return callRoute(staffPatch, { method: "PATCH", url: `/api/staff/${id}`, cookie, params: { id }, body });
}

describe("직원 계정 관리", () => {
  it("관리자는 간호 직원을 추가하고, 그 직원은 바로 로그인한다. 다른 역할은 403", async () => {
    const front = await loginAs("FRONT");
    expect((await create(front.cookie, { loginId: "nurse9", name: "가상간호", role: "NURSE", password: PW })).status).toBe(403);

    const admin = await loginAs("ADMIN");
    const res = await create(admin.cookie, { loginId: "Nurse9", name: "가상간호", role: "NURSE", password: PW });
    expect(res.status).toBe(201);
    const login = await callRoute(loginRoute, { method: "POST", url: "/api/auth/login", body: { loginId: "nurse9", password: PW } });
    expect(login.status).toBe(200);
    expect(login.json.staff.role).toBe("NURSE");

    const list = await callRoute(accountsRoute, { url: "/api/staff/accounts", cookie: admin.cookie });
    expect(list.json.staff.map((s: { loginId: string }) => s.loginId)).toContain("nurse9");
    expect(JSON.stringify(list.json)).not.toContain("passwordHash");
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "STAFF_CREATE", result: "SUCCESS" } });
    expect(JSON.stringify(audit)).not.toContain(PW);
  });

  it("아이디 형식·중복, 약한 비밀번호는 거부", async () => {
    const admin = await loginAs("ADMIN");
    expect((await create(admin.cookie, { loginId: "a!", name: "가상", role: "FRONT", password: PW })).status).toBe(400);
    expect((await create(admin.cookie, { loginId: "front9", name: "가상", role: "FRONT", password: "short" })).json.error.code).toBe("WEAK_PASSWORD");
    await create(admin.cookie, { loginId: "front9", name: "가상", role: "FRONT", password: PW });
    expect((await create(admin.cookie, { loginId: "front9", name: "가상2", role: "FRONT", password: PW })).status).toBe(409);
  });

  it("비활성화하면 그 직원의 세션이 바로 끊긴다(T2-5). 역할 변경은 감사 행에 이전·이후 역할로 남는다", async () => {
    const admin = await loginAs("ADMIN");
    const target = await loginAs("FRONT");
    expect((await callRoute(meRoute, { cookie: target.cookie })).status).toBe(200);

    expect((await patch(admin.cookie, target.staff.id, { role: "COUNSELOR" })).status).toBe(200);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "STAFF_UPDATE", result: "SUCCESS" } });
    expect(audit.detail).toMatchObject({ fromRole: "FRONT", toRole: "COUNSELOR" });

    const off = await patch(admin.cookie, target.staff.id, { isActive: false });
    expect(off.status).toBe(200);
    expect((await callRoute(meRoute, { cookie: target.cookie })).status).toBe(401);
  });

  it("비밀번호 초기화는 잠금을 풀고 기존 세션을 끊는다", async () => {
    const admin = await loginAs("ADMIN");
    const target = await loginAs("FRONT", { loginId: "front7", lockedAt: new Date(), failedLoginCount: 5 });
    expect((await patch(admin.cookie, target.staff.id, { password: PW })).status).toBe(200);
    expect((await callRoute(meRoute, { cookie: target.cookie })).status).toBe(401);
    const login = await callRoute(loginRoute, { method: "POST", url: "/api/auth/login", body: { loginId: "front7", password: PW } });
    expect(login.status).toBe(200);
  });

  it("자기 계정 비활성화·역할 변경, 마지막 관리자 없애기는 409", async () => {
    const admin = await loginAs("ADMIN");
    expect((await patch(admin.cookie, admin.staff.id, { isActive: false })).json.error.code).toBe("CANNOT_CHANGE_SELF");
    expect((await patch(admin.cookie, admin.staff.id, { role: "FRONT" })).json.error.code).toBe("CANNOT_CHANGE_SELF");
    // 관리자가 둘이면 한 명을 강등할 수 있다
    const second = await loginAs("ADMIN");
    expect((await patch(second.cookie, admin.staff.id, { role: "FRONT" })).status).toBe(200);
    // 이제 활성 관리자는 second 하나 — 다른 관리자가 없으니 누구도 second를 없앨 수 없다(자기 자신도 불가)
    expect((await patch(second.cookie, second.staff.id, { isActive: false })).status).toBe(409);
  });
});

describe("체어·열 묶음 (PUT /api/settings/chairs)", () => {
  it("관리자만, 묶음 이름·순서가 저장된다", async () => {
    const front = await loginAs("FRONT");
    const body = {
      chairs: [
        { code: "C1", name: "체어 1", kind: "CHAIR", group: "보철과" },
        { code: "OP1", name: "수술방", kind: "CHAIR", group: "수술과" },
        { code: "R1", name: "상담실", kind: "CONSULT_ROOM", group: "상담" },
      ],
    };
    expect((await callRoute(chairsRoute, { method: "PUT", url: "/api/settings/chairs", cookie: front.cookie, body })).status).toBe(403);
    const admin = await loginAs("ADMIN");
    const res = await callRoute(chairsRoute, { method: "PUT", url: "/api/settings/chairs", cookie: admin.cookie, body });
    expect(res.status).toBe(200);
    const setting = await db.clinicSetting.findUniqueOrThrow({ where: { id: 1 } });
    expect(setting.chairs).toEqual(body.chairs);
  });

  it("오늘 이후 예약이 있는 체어는 뺄 수 없고, 같은 코드 두 번·진료 체어 없음은 400", async () => {
    const admin = await loginAs("ADMIN");
    await createAppointment({ chair: "C2", startAt: kstDateTime(addDays(kstDateKey(new Date()), 1), "10:00") });
    const without = DEFAULT_CLINIC_SETTINGS.chairs.filter((c) => c.code !== "C2");
    const res = await callRoute(chairsRoute, { method: "PUT", url: "/api/settings/chairs", cookie: admin.cookie, body: { chairs: without } });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("CHAIR_IN_USE");
    for (const chairs of [
      [{ code: "C1", name: "a", kind: "CHAIR" }, { code: "C1", name: "b", kind: "CHAIR" }],
      [{ code: "R1", name: "상담실", kind: "CONSULT_ROOM" }],
    ]) {
      expect((await callRoute(chairsRoute, { method: "PUT", url: "/api/settings/chairs", cookie: admin.cookie, body: { chairs } })).status).toBe(400);
    }
  });
});

describe("진료시간·기준 (PUT /api/settings/clinic)", () => {
  it("저장되고, 시작이 끝보다 늦으면 400", async () => {
    const admin = await loginAs("ADMIN");
    const hours = { ...DEFAULT_CLINIC_SETTINGS.businessHours, "6": { open: "10:00", close: "15:00" } };
    const ok = await callRoute(clinicRoute, {
      method: "PUT",
      url: "/api/settings/clinic",
      cookie: admin.cookie,
      body: { lateToleranceMin: 10, noShowGraceMin: 20, businessHours: hours },
    });
    expect(ok.status).toBe(200);
    expect(await db.clinicSetting.findUniqueOrThrow({ where: { id: 1 } })).toMatchObject({ lateToleranceMin: 10, noShowGraceMin: 20, businessHours: hours });
    const bad = await callRoute(clinicRoute, {
      method: "PUT",
      url: "/api/settings/clinic",
      cookie: admin.cookie,
      body: { lateToleranceMin: 10, noShowGraceMin: 20, businessHours: { ...hours, "1": { open: "18:00", close: "09:00" } } },
    });
    expect(bad.status).toBe(400);
  });
});

describe("T4-4 완료 기준: 설정 변경이 내원 보드 판정에 즉시 반영", () => {
  it("지각 허용시간을 15분 → 5분으로 바꾸면 10분 늦은 내원이 바로 지각내원이 된다", async () => {
    const admin = await loginAs("ADMIN");
    const today = kstDateKey(new Date());
    const start = kstDateTime(today, "00:00");
    const visit = await createAppointment({ startAt: start, status: "ARRIVED", arrivedAt: new Date(start.getTime() + 10 * 60_000) });
    const board = async () =>
      (await callRoute(boardRoute, { url: `/api/board?date=${today}`, cookie: admin.cookie })).json.items.find(
        (row: { id: string }) => row.id === visit.id,
      );
    expect(await board()).toMatchObject({ isLate: false });
    const res = await callRoute(clinicRoute, {
      method: "PUT",
      url: "/api/settings/clinic",
      cookie: admin.cookie,
      body: { lateToleranceMin: 5, noShowGraceMin: 30, businessHours: DEFAULT_CLINIC_SETTINGS.businessHours },
    });
    expect(res.status).toBe(200);
    expect(await board()).toMatchObject({ isLate: true, statusLabel: "지각내원" });
  });
});
