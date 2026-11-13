/**
 * 확장 계획 S-2b — 직무별 권한은 DB(job_permission)가 기준이다.
 * - 첫 설치 값은 마이그레이션이 한 번만 넣고(INITIAL_JOB_PERMISSIONS와 같음), 시드는 덮어쓰지 않는다.
 * - 바꾸면 재시작 없이 다음 요청부터 반영된다(캐시 없음).
 * - 권한 관리 권한(staff.manage)을 가진 활성 직원이 0명이 되는 변경은 거부한다(역할이 아니라 실제 권한 기준).
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as meRoute } from "@/app/api/auth/me/route";
import { GET as statsRoute } from "@/app/api/stats/route";
import { INITIAL_JOB_PERMISSIONS, PERMISSION_MANAGER } from "@/lib/auth/permissions";
import { STAFF_ROLES } from "@/lib/domain/staff";
import { ApiError } from "@/server/api/errors";
import { assertPermissionManagerRemains } from "@/server/auth/access";
import { updateStaffAccount } from "@/server/staff/manage";
import { seed } from "../../prisma/seed";
import { callRoute, loginAs } from "./helpers/api";
import { createStaff, db, resetDb } from "./helpers";

beforeEach(resetDb);

const MIGRATION = join(process.cwd(), "prisma/migrations/20261113010000_job_permission/migration.sql");
const STATS_URL = "/api/stats?from=2026-11-01&to=2026-11-07&unit=day";

class Rollback extends Error {}

/** route와 같이 트랜잭션 안에서 부른다 — 검사에 걸리면 변경이 되돌려진다 */
const update = (actorId: string, id: string, input: Parameters<typeof updateStaffAccount>[3]) =>
  db.$transaction((tx) => updateStaffAccount(tx, actorId, id, input, new Date()));

async function rolledBack<T>(work: (tx: typeof db) => Promise<T>): Promise<T> {
  let result: T | undefined;
  await db
    .$transaction(async (tx) => {
      result = await work(tx as unknown as typeof db);
      throw new Rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
  return result as T;
}

async function rowsByRole(client: typeof db) {
  const rows = await client.jobPermission.findMany({ select: { role: true, permission: true } });
  return Object.fromEntries(STAFF_ROLES.map((role) => [role, rows.filter((r) => r.role === role).map((r) => r.permission).sort()]));
}

const initialByRole = () =>
  Object.fromEntries(STAFF_ROLES.map((role) => [role, [...INITIAL_JOB_PERMISSIONS[role]].sort()]));

describe("첫 설치 값", () => {
  it("마이그레이션의 INSERT가 넣는 값 = INITIAL_JOB_PERMISSIONS", async () => {
    const sql = readFileSync(MIGRATION, "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    const inserts = sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => /^INSERT\s/i.test(s));
    expect(inserts.length).toBeGreaterThan(0);
    const rows = await rolledBack(async (tx) => {
      await tx.jobPermission.deleteMany({});
      for (const statement of inserts) await tx.$executeRawUnsafe(statement);
      return rowsByRole(tx);
    });
    expect(rows).toEqual(initialByRole());
  });

  it("시드를 다시 돌려도 관리자가 바꾼 직무 권한을 덮어쓰지 않는다", async () => {
    await db.jobPermission.create({ data: { role: "FRONT", permission: "stats.read" } });
    await db.jobPermission.deleteMany({ where: { role: "NURSE", permission: "visit.write" } });
    const before = await rowsByRole(db);
    await seed(db, { FAKE_DATA_ALLOWED: "true", SEED_STAFF_PASSWORD: randomBytes(18).toString("base64url") });
    expect(await rowsByRole(db)).toEqual(before);
    expect(before.FRONT).toContain("stats.read");
    expect(before.NURSE).not.toContain("visit.write");
  });

  it("같은 직무·권한은 한 줄만 (DB 제약)", async () => {
    await expect(db.jobPermission.create({ data: { role: "FRONT", permission: "patient.read" } })).rejects.toThrow();
  });
});

describe("DB가 기준 — 바꾸면 다음 요청부터 반영", () => {
  it("프론트 직무에 통계 보기를 켜고 끄면 같은 세션에서 바로 200 ↔ 403", async () => {
    const front = await loginAs("FRONT");
    expect((await callRoute(statsRoute, { url: STATS_URL, cookie: front.cookie })).status).toBe(403);

    await db.jobPermission.create({ data: { role: "FRONT", permission: "stats.read" } });
    expect((await callRoute(statsRoute, { url: STATS_URL, cookie: front.cookie })).status).toBe(200);
    const me = (await callRoute(meRoute, { url: "/api/auth/me", cookie: front.cookie })).json;
    expect(me.permissions).toContain("stats.read");
    expect(me.navSections).toContain("stats");

    await db.jobPermission.deleteMany({ where: { role: "FRONT", permission: "stats.read" } });
    expect((await callRoute(statsRoute, { url: STATS_URL, cookie: front.cookie })).status).toBe(403);
  });

  it("DB에 모르는 권한 이름이 있어도 아무 권한이 되지 않는다", async () => {
    await db.jobPermission.create({ data: { role: "FRONT", permission: "stats.read.all" } });
    const front = await loginAs("FRONT");
    expect((await callRoute(statsRoute, { url: STATS_URL, cookie: front.cookie })).status).toBe(403);
  });

  it("직무에서 권한을 모두 빼면 그 직무는 아무것도 못 한다 (코드에 숨은 기본값 없음)", async () => {
    await db.jobPermission.deleteMany({ where: { role: "NURSE" } });
    const nurse = await loginAs("NURSE");
    const me = (await callRoute(meRoute, { url: "/api/auth/me", cookie: nurse.cookie })).json;
    expect(me.permissions).toEqual([]);
    expect(me.navSections).toEqual([]);
  });
});

describe("권한 관리자 0명 방지 (설정으로 풀 수 없음)", () => {
  it("마지막 권한 관리자는 비활성화할 수 없다", async () => {
    const admin = await createStaff({ role: "ADMIN" });
    const other = await createStaff({ role: "FRONT" });
    await expect(update(other.id, admin.id, { isActive: false })).rejects.toMatchObject({
      status: 409,
      code: "LAST_PERMISSION_MANAGER",
    });
    expect((await db.staff.findUniqueOrThrow({ where: { id: admin.id } })).isActive).toBe(true);
  });

  it("역할이 아니라 실제 권한으로 센다 — 관리자 직무에서 권한 관리를 빼면 개인 추가 권한을 가진 사람이 마지막 관리자", async () => {
    await db.jobPermission.deleteMany({ where: { role: "ADMIN", permission: PERMISSION_MANAGER } });
    const admin = await createStaff({ role: "ADMIN" });
    const manager = await createStaff({ role: "FRONT", extraPermissions: [PERMISSION_MANAGER] });
    // 관리자 직무는 이제 권한 관리자가 아니므로 비활성화해도 된다
    await update(manager.id, admin.id, { isActive: false });
    // 남은 유일한 권한 관리자(프론트 + 추가 권한)는 비활성화할 수 없다
    await expect(update(admin.id, manager.id, { isActive: false })).rejects.toMatchObject({
      code: "LAST_PERMISSION_MANAGER",
    });
  });

  it("관리자가 둘이면 한 명의 직무를 바꿀 수 있고, 남은 한 명은 없앨 수 없다", async () => {
    const a = await createStaff({ role: "ADMIN" });
    const b = await createStaff({ role: "ADMIN" });
    await update(b.id, a.id, { role: "FRONT" });
    await expect(update(a.id, b.id, { role: "NURSE" })).rejects.toBeInstanceOf(ApiError);
    expect((await db.staff.findUniqueOrThrow({ where: { id: b.id } })).role).toBe("ADMIN");
  });

  it("assertPermissionManagerRemains: 권한 관리자가 없으면 409 (S-7 권한 편집도 이 검사를 쓴다)", async () => {
    await createStaff({ role: "ADMIN", isActive: false });
    await expect(assertPermissionManagerRemains(db)).rejects.toMatchObject({ code: "LAST_PERMISSION_MANAGER" });
    await createStaff({ role: "ADMIN" });
    await expect(assertPermissionManagerRemains(db)).resolves.toBeUndefined();
  });
});
