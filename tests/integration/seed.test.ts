/**
 * T1-4 완료 기준 — 시드 후 바로 로그인할 수 있다.
 * 계정이 활성·잠금 해제 상태로 있고, 저장된 해시가 SEED_STAFF_PASSWORD로 검증되는지 확인한다.
 * (로그인 화면을 거치는 확인은 T2-1이 한다.)
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CLINIC_SETTINGS } from "@/lib/domain/clinic";
import { STAFF_ROLES } from "@/lib/domain/staff";
import { verifyPassword } from "@/server/auth/password";
import { seed } from "../../prisma/seed";
import { db, resetDb } from "./helpers";

// 테스트용 가짜 비밀번호. 실제 .env의 값과 무관하다.
const PASSWORD = "seed-test-password-0000";
const FAKE_ENV = { FAKE_DATA_ALLOWED: "true", SEED_STAFF_PASSWORD: PASSWORD };

beforeEach(resetDb);

async function settingRow() {
  const rows = await db.clinicSetting.findMany();
  expect(rows).toHaveLength(1);
  return rows[0];
}

describe("seed — 테스트 계정", () => {
  it("두 번 실행해도 직원은 6명이고 다섯 역할이 모두 있다", async () => {
    await seed(db, FAKE_ENV);
    await seed(db, FAKE_ENV);

    const staff = await db.staff.findMany({ orderBy: { loginId: "asc" } });
    expect(staff.map((s) => [s.loginId, s.role])).toEqual([
      ["admin", "ADMIN"],
      ["counselor1", "COUNSELOR"],
      ["doctor1", "DOCTOR"],
      ["doctor2", "DOCTOR"],
      ["front1", "FRONT"],
      ["nurse1", "NURSE"],
    ]);
    expect(new Set(staff.map((s) => s.role))).toEqual(new Set(STAFF_ROLES));
    for (const s of staff) {
      expect(s.branch).toBe("본점");
      expect(s.isActive).toBe(true);
      expect(s.lockedAt).toBeNull();
      expect(s.failedLoginCount).toBe(0);
      expect(s.passwordHash).not.toContain(PASSWORD);
      expect(await verifyPassword(s.passwordHash, PASSWORD)).toBe(true);
      expect(await verifyPassword(s.passwordHash, `${PASSWORD}x`)).toBe(false);
    }
  });

  it("다시 시드하면 잠금·실패 횟수·비활성을 풀고 비밀번호를 새 값으로 바꾼다", async () => {
    await seed(db, FAKE_ENV);
    const before = await db.staff.findUniqueOrThrow({ where: { loginId: "front1" } });
    await db.staff.update({
      where: { loginId: "front1" },
      data: { failedLoginCount: 5, lockedAt: new Date(), isActive: false },
    });

    const newPassword = "seed-test-password-0001";
    await seed(db, { ...FAKE_ENV, SEED_STAFF_PASSWORD: newPassword });

    const after = await db.staff.findUniqueOrThrow({ where: { loginId: "front1" } });
    expect(after.id).toBe(before.id);
    expect(after.failedLoginCount).toBe(0);
    expect(after.lockedAt).toBeNull();
    expect(after.isActive).toBe(true);
    expect(await verifyPassword(after.passwordHash, newPassword)).toBe(true);
    expect(await verifyPassword(after.passwordHash, PASSWORD)).toBe(false);
  });

  it("FAKE_DATA_ALLOWED가 없으면 직원은 만들지 않고 병원 설정만 만든다", async () => {
    const result = await seed(db, { SEED_STAFF_PASSWORD: PASSWORD });
    expect(result.staff).toBeNull();
    expect(await db.staff.count()).toBe(0);
    await settingRow();
  });

  it("FAKE_DATA_ALLOWED가 true가 아니면 계정을 만들지 않는다", async () => {
    await seed(db, { FAKE_DATA_ALLOWED: "1", SEED_STAFF_PASSWORD: PASSWORD });
    expect(await db.staff.count()).toBe(0);
  });

  it("비밀번호가 없거나 12자보다 짧으면 값을 드러내지 않고 실패한다", async () => {
    await expect(seed(db, { FAKE_DATA_ALLOWED: "true" })).rejects.toThrow(/SEED_STAFF_PASSWORD/);
    const short = "short-0000a";
    const error = await seed(db, { FAKE_DATA_ALLOWED: "true", SEED_STAFF_PASSWORD: short }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/12자/);
    expect((error as Error).message).not.toContain(short);
    expect(await db.staff.count()).toBe(0);
  });
});

describe("seed — 병원 설정", () => {
  it("없으면 기본값으로 id 1 행을 하나 만든다", async () => {
    await seed(db, FAKE_ENV);
    await seed(db, FAKE_ENV);
    const row = await settingRow();
    expect(row).toMatchObject({
      id: 1,
      lateToleranceMin: DEFAULT_CLINIC_SETTINGS.lateToleranceMin,
      noShowGraceMin: DEFAULT_CLINIC_SETTINGS.noShowGraceMin,
      businessHours: DEFAULT_CLINIC_SETTINGS.businessHours,
      chairs: DEFAULT_CLINIC_SETTINGS.chairs,
      treatmentItems: DEFAULT_CLINIC_SETTINGS.treatmentItems,
    });
  });

  it("나중에 바꾼 설정은 다시 시드해도 덮어쓰지 않는다", async () => {
    await seed(db, FAKE_ENV);
    await db.clinicSetting.update({
      where: { id: 1 },
      data: { lateToleranceMin: 20, treatmentItems: ["정기검진"] },
    });
    const result = await seed(db, FAKE_ENV);
    expect(result.clinicSettingCreated).toBe(false);
    const row = await settingRow();
    expect(row.lateToleranceMin).toBe(20);
    expect(row.treatmentItems).toEqual(["정기검진"]);
  });
});
