/**
 * 확장 계획 S-4 — 부서별 첫 화면은 설정값(clinic_setting.department_homes)이다. 프로그램은 초기값만 가진다.
 */
import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { GET as meRoute } from "@/app/api/auth/me/route";
import { PUT as homesRoute } from "@/app/api/settings/department-homes/route";
import { GET as settingsRoute } from "@/app/api/settings/route";
import { INITIAL_DEPARTMENT_HOMES } from "@/lib/auth/screen-registry";
import { DEFAULT_CLINIC_SETTINGS } from "@/lib/domain/clinic";
import type { StaffRole } from "@/lib/domain/staff";
import { hashPassword } from "@/server/auth/password";
import { seed } from "../../prisma/seed";
import { callRoute, loginAs } from "./helpers/api";
import { createStaff, db, resetDb } from "./helpers";

async function createSetting() {
  // department_homes를 주지 않는다 — DB 기본값(첫 설치 값)이 들어가야 한다
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
}

beforeEach(async () => {
  await resetDb();
  await createSetting();
});

const homeOf = async (cookie: string) => (await callRoute(meRoute, { url: "/api/auth/me", cookie })).json.home as string;
const put = (cookie: string, body: unknown) => callRoute(homesRoute, { method: "PUT", url: "/api/settings/department-homes", cookie, body });

describe("첫 설치 값", () => {
  it("설정 행의 기본값 = INITIAL_DEPARTMENT_HOMES", async () => {
    expect((await db.clinicSetting.findUniqueOrThrow({ where: { id: 1 } })).departmentHomes).toEqual(INITIAL_DEPARTMENT_HOMES);
  });

  it("직무별 첫 화면: 프론트 내원 보드, 상담 상담, 의사·간호 예약 캘린더, 관리자 통계", async () => {
    const expected: Record<StaffRole, string> = { FRONT: "/board", COUNSELOR: "/consult", DOCTOR: "/calendar", NURSE: "/calendar", ADMIN: "/stats" };
    for (const [role, home] of Object.entries(expected) as [StaffRole, string][]) {
      const me = (await callRoute(meRoute, { url: "/api/auth/me", cookie: (await loginAs(role)).cookie })).json;
      expect(me.home, role).toBe(home);
    }
  });

  it("로그인 응답에도 첫 화면이 있다", async () => {
    const password = randomBytes(18).toString("base64url");
    const staff = await createStaff({ role: "COUNSELOR", passwordHash: await hashPassword(password) });
    const res = await callRoute(loginRoute, { method: "POST", url: "/api/auth/login", body: { loginId: staff.loginId, password } });
    expect(res.status).toBe(200);
    expect(res.json.staff.home).toBe("/consult");
  });

  it("설정 행이 없어도(설치 직후) 초기값으로 동작한다", async () => {
    await db.clinicSetting.deleteMany({});
    expect(await homeOf((await loginAs("COUNSELOR")).cookie)).toBe("/consult");
  });
});

describe("관리자가 바꾼다 (PUT /api/settings/department-homes)", () => {
  it("관리자만. 바꾸면 다음 요청부터 그 부서의 첫 화면이 바뀌고 감사 로그에 남는다", async () => {
    const front = await loginAs("FRONT");
    const admin = await loginAs("ADMIN");
    const body = { ...INITIAL_DEPARTMENT_HOMES, FRONT: "/calendar" };
    expect((await put(front.cookie, body)).status).toBe(403);
    const res = await put(admin.cookie, body);
    expect(res.status).toBe(200);
    expect(await homeOf(front.cookie)).toBe("/calendar");
    expect(await db.auditLog.count({ where: { action: "SETTINGS_DEPARTMENT_HOMES_UPDATE", result: "SUCCESS" } })).toBe(1);
    const settings = (await callRoute(settingsRoute, { url: "/api/settings", cookie: front.cookie })).json;
    expect(settings.departmentHomes).toEqual(body);
  });

  it("메뉴 화면만 고를 수 있고, 네 부서를 모두 보내야 한다", async () => {
    const admin = await loginAs("ADMIN");
    expect((await put(admin.cookie, { ...INITIAL_DEPARTMENT_HOMES, FRONT: "/patients/new" })).status).toBe(400);
    expect((await put(admin.cookie, { ...INITIAL_DEPARTMENT_HOMES, FRONT: "javascript:alert(1)" })).status).toBe(400);
    expect((await put(admin.cookie, { FRONT: "/board" })).status).toBe(400);
    expect((await put(admin.cookie, { ...INITIAL_DEPARTMENT_HOMES, EXTRA: "/board" })).status).toBe(400);
  });

  it("권한이 없는 화면을 첫 화면으로 정해 두면 그 사람은 볼 수 있는 메뉴의 첫 화면으로 간다", async () => {
    const admin = await loginAs("ADMIN");
    expect((await put(admin.cookie, { ...INITIAL_DEPARTMENT_HOMES, FRONT: "/stats" })).status).toBe(200);
    expect(await homeOf((await loginAs("FRONT")).cookie)).toBe("/board");
    expect(await homeOf((await loginAs("FRONT", { extraPermissions: ["stats.read"] })).cookie)).toBe("/stats");
  });

  it("시드를 다시 돌려도 바꾼 첫 화면을 덮어쓰지 않는다", async () => {
    const admin = await loginAs("ADMIN");
    await put(admin.cookie, { ...INITIAL_DEPARTMENT_HOMES, CLINICAL: "/board" });
    await seed(db, { FAKE_DATA_ALLOWED: "true", SEED_STAFF_PASSWORD: randomBytes(18).toString("base64url") });
    expect((await db.clinicSetting.findUniqueOrThrow({ where: { id: 1 } })).departmentHomes).toMatchObject({ CLINICAL: "/board" });
  });
});
