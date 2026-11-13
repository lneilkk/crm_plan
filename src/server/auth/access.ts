import "server-only";

import { PERMISSION_MANAGER, type Permission, permissionsOf } from "@/lib/auth/permissions";
import type { StaffRole } from "@/lib/domain/staff";
import { ApiError } from "@/server/api/errors";
import { db, type DbClient } from "@/server/db";

/**
 * 직원 권한 계산 (확장 계획 S-2b) — DB의 직무 권한(job_permission) ∪ 개인 추가 권한(staff.extra_permissions).
 * 요청마다 DB에서 새로 읽는다(캐시 없음). 관리자가 권한을 바꾸면 다음 요청부터 반영된다.
 */
export async function loadPermissions(
  staff: { role: StaffRole; extraPermissions: readonly string[] },
  client: DbClient = db,
): Promise<Permission[]> {
  const rows = await client.jobPermission.findMany({ where: { role: staff.role }, select: { permission: true } });
  return permissionsOf({ jobPermissions: rows.map((row) => row.permission), extraPermissions: staff.extraPermissions });
}

/** 권한에 영향을 주는 변경(직원 비활성화·직무 변경·권한 편집)을 한 번에 하나씩 하도록 트랜잭션 잠금을 건다. */
const PERMISSION_CHANGE_LOCK = 0x5032_4220; // 임의의 고정 값 ("P2B ")

export async function lockPermissionChanges(client: DbClient): Promise<void> {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(${PERMISSION_CHANGE_LOCK})`;
}

/**
 * 권한 관리 권한(staff.manage)을 가진 활성 직원이 한 명 이상 남아 있는지. 없으면 409.
 * 설정으로 풀 수 없는 규칙이다. 변경을 적용한 뒤 같은 트랜잭션 안에서 부르고, 실패하면 변경이 되돌려진다.
 * 역할(직무 이름)이 아니라 실제 권한으로 센다.
 */
export async function assertPermissionManagerRemains(client: DbClient): Promise<void> {
  const [managerJobs, active] = await Promise.all([
    client.jobPermission.findMany({ where: { permission: PERMISSION_MANAGER }, select: { role: true } }),
    client.staff.findMany({ where: { isActive: true }, select: { role: true, extraPermissions: true } }),
  ]);
  const jobs = new Set(managerJobs.map((row) => row.role));
  const remains = active.some((staff) => jobs.has(staff.role) || staff.extraPermissions.includes(PERMISSION_MANAGER));
  if (!remains) {
    throw new ApiError(
      409,
      "LAST_PERMISSION_MANAGER",
      "권한을 관리할 수 있는 직원이 한 명은 남아 있어야 합니다. 다른 직원에게 직원 계정 관리 권한을 먼저 주세요.",
    );
  }
}
