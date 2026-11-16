/**
 * 확장 계획 S-2 — 직무 기본 권한 + 개인 추가 권한.
 * - 변환 마이그레이션 SQL을 실제로 돌려, 기존 계정의 사람별 권한이 S-2 전과 같아짐을 확인한다.
 * - 서버 권한 검사(defineRoute)가 추가 권한을 반영하는지, 화면에 내려 보내는 "나" 정보가 맞는지 확인한다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as meRoute } from "@/app/api/auth/me/route";
import { GET as consultListRoute } from "@/app/api/consultations/route";
import { GET as statsRoute } from "@/app/api/stats/route";
import { INITIAL_JOB_PERMISSIONS, LEGACY_ROLE_EXTRAS, permissionsOf } from "@/lib/auth/permissions";
import { STAFF_ROLES } from "@/lib/domain/staff";
import { callRoute, loginAs } from "./helpers/api";
import { createStaff, db, resetDb } from "./helpers";

beforeEach(resetDb);

const MIGRATION = join(process.cwd(), "prisma/migrations/20261113000000_staff_extra_permissions/migration.sql");

/** 마이그레이션의 변환 문장(UPDATE)만. 컬럼 추가는 테스트 DB에 이미 적용되어 있다. */
function conversionStatements(): string[] {
  const sql = readFileSync(MIGRATION, "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const updates = statements.filter((s) => /^UPDATE\s/i.test(s));
  expect(updates.length, "변환 UPDATE 문").toBeGreaterThan(0);
  return updates;
}

class Rollback extends Error {}

describe("변환 마이그레이션 (S-2)", () => {
  it("S-2 전 계정(추가 권한 없음)에 SQL을 돌리면 사람별 권한이 S-2 전과 같아진다", async () => {
    const results: { role: string; extras: string[] }[] = [];
    // 다른 테스트 데이터에 남지 않도록 트랜잭션 안에서 돌리고 되돌린다
    await db
      .$transaction(async (tx) => {
        const ids: string[] = [];
        for (const role of STAFF_ROLES) {
          const staff = await tx.staff.create({
            data: { loginId: `legacy-${role}`, name: "변환전", role, passwordHash: "test-placeholder-not-a-password-hash" },
          });
          ids.push(staff.id);
        }
        for (const statement of conversionStatements()) await tx.$executeRawUnsafe(statement);
        const rows = await tx.staff.findMany({ where: { id: { in: ids } }, select: { role: true, extraPermissions: true } });
        results.push(...rows.map((row) => ({ role: row.role, extras: row.extraPermissions })));
        throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });

    expect(results).toHaveLength(STAFF_ROLES.length);
    for (const { role, extras } of results) {
      const r = role as (typeof STAFF_ROLES)[number];
      expect(extras, `${role} 추가 권한`).toEqual([...LEGACY_ROLE_EXTRAS[r]]);
      // 단위 테스트(permissions.test.ts)가 이 값이 S-2 전 표와 같음을 증명한다
      expect(permissionsOf({ jobPermissions: INITIAL_JOB_PERMISSIONS[r], extraPermissions: extras })).toEqual(
        permissionsOf({ jobPermissions: INITIAL_JOB_PERMISSIONS[r], extraPermissions: LEGACY_ROLE_EXTRAS[r] }),
      );
    }
    expect(await db.staff.count({ where: { loginId: { startsWith: "legacy-" } } })).toBe(0);
  });

  it("이미 추가 권한이 있는 의사 계정은 덮어쓰지 않는다", async () => {
    let extras: string[] = [];
    await db
      .$transaction(async (tx) => {
        const staff = await tx.staff.create({
          data: {
            loginId: "legacy-doctor-custom",
            name: "변환전",
            role: "DOCTOR",
            extraPermissions: ["stats.read"],
            passwordHash: "test-placeholder-not-a-password-hash",
          },
        });
        for (const statement of conversionStatements()) await tx.$executeRawUnsafe(statement);
        extras = (await tx.staff.findUniqueOrThrow({ where: { id: staff.id } })).extraPermissions;
        throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });
    expect(extras).toEqual(["stats.read"]);
  });

  it("새로 만든 직원의 추가 권한 기본값은 빈 목록", async () => {
    const staff = await createStaff({ role: "DOCTOR" });
    expect(staff.extraPermissions).toEqual([]);
  });
});

describe("서버 권한 검사가 추가 권한을 반영한다", () => {
  it("추가 권한이 없는 의사는 통계·상담 목록이 403, 원장(추가 권한)은 200", async () => {
    const plain = await loginAs("DOCTOR", { extraPermissions: [] });
    const director = await loginAs("DOCTOR"); // LEGACY_ROLE_EXTRAS: 통계·상담 보기
    const stats = "/api/stats?from=2026-11-01&to=2026-11-07&unit=day";
    const consult = "/api/consultations?date=2026-11-12";

    expect((await callRoute(statsRoute, { url: stats, cookie: plain.cookie })).status).toBe(403);
    expect((await callRoute(consultListRoute, { url: consult, cookie: plain.cookie })).status).toBe(403);
    expect((await callRoute(statsRoute, { url: stats, cookie: director.cookie })).status).toBe(200);
    expect((await callRoute(consultListRoute, { url: consult, cookie: director.cookie })).status).toBe(200);

    const denied = await db.auditLog.count({ where: { staffId: plain.staff.id, result: "DENIED" } });
    expect(denied).toBe(2);
  });

  it("다른 직무에 준 추가 권한도 반영된다 (간호 + 통계)", async () => {
    const nurse = await loginAs("NURSE", { extraPermissions: ["stats.read"] });
    const res = await callRoute(statsRoute, { url: "/api/stats?from=2026-11-01&to=2026-11-07&unit=day", cookie: nurse.cookie });
    expect(res.status).toBe(200);
  });

  it("DB에 모르는 권한 이름이 있어도 아무 권한이 되지 않는다", async () => {
    const front = await loginAs("FRONT", { extraPermissions: ["stats.read.all", "admin"] });
    const res = await callRoute(statsRoute, { url: "/api/stats?from=2026-11-01&to=2026-11-07&unit=day", cookie: front.cookie });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/auth/me", () => {
  it("부서·권한 목록·메뉴를 서버가 계산해 준다 (추가 권한 원본은 주지 않음)", async () => {
    const nurse = await loginAs("NURSE");
    const { status, json } = await callRoute(meRoute, { url: "/api/auth/me", cookie: nurse.cookie });
    expect(status).toBe(200);
    expect(json).toMatchObject({ role: "NURSE", department: "CLINICAL", navSections: ["board", "calendar", "patients"] });
    expect(json.permissions).toEqual(permissionsOf({ jobPermissions: INITIAL_JOB_PERMISSIONS.NURSE, extraPermissions: [] }));
    expect(json).not.toHaveProperty("extraPermissions");

    const director = await loginAs("DOCTOR");
    const me = (await callRoute(meRoute, { url: "/api/auth/me", cookie: director.cookie })).json;
    expect(me.department).toBe("CLINICAL");
    expect(me.permissions).toContain("stats.read");
    expect(me.navSections).toEqual(["board", "calendar", "consult", "patients", "stats"]);

    const plain = await loginAs("DOCTOR", { extraPermissions: [] });
    const plainMe = (await callRoute(meRoute, { url: "/api/auth/me", cookie: plain.cookie })).json;
    expect(plainMe.permissions).not.toContain("stats.read");
    expect(plainMe.navSections).toEqual(["board", "calendar", "patients"]);
  });
});
