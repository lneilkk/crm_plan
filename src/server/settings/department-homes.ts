import "server-only";

import { DEPARTMENT_NAMES, type Department } from "@/lib/auth/permissions";
import { INITIAL_DEPARTMENT_HOMES } from "@/lib/auth/screen-registry";
import { ApiError } from "@/server/api/errors";
import { db, type DbClient } from "@/server/db";

/**
 * 부서별 첫 화면 (확장 계획 S-4) — clinic_setting.department_homes. 요청마다 읽는다(캐시 없음).
 * 설정 행이 없으면(설치 직후) 첫 설치 값을 쓴다. 값을 쓰기 전에 homeFor가 고를 수 있는 화면·권한을 다시 확인한다.
 */
export async function getDepartmentHomes(client: Pick<DbClient, "clinicSetting"> = db): Promise<Record<string, unknown>> {
  const row = await client.clinicSetting.findUnique({ where: { id: 1 }, select: { departmentHomes: true } });
  const value = row?.departmentHomes;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : { ...INITIAL_DEPARTMENT_HOMES };
}

export async function saveDepartmentHomes(client: DbClient, homes: Record<Department, string>, actorId: string): Promise<Record<Department, string>> {
  const value = Object.fromEntries(DEPARTMENT_NAMES.map((d) => [d, homes[d]])) as Record<Department, string>;
  const updated = await client.clinicSetting.updateMany({ where: { id: 1 }, data: { departmentHomes: value, updatedById: actorId } });
  if (updated.count !== 1) throw new ApiError(500, "SETTINGS_MISSING", "병원 설정이 없습니다. npm run db:seed");
  return value;
}
