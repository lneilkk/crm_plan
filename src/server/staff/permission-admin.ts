import "server-only";

import { isPermission, isSensitivePermission, type Permission, PERMISSION_NAMES } from "@/lib/auth/permissions";
import { STAFF_ROLES, type StaffRole } from "@/lib/domain/staff";
import { ApiError } from "@/server/api/errors";
import { assertPermissionManagerRemains, lockPermissionChanges } from "@/server/auth/access";
import type { DbClient } from "@/server/db";

/**
 * 권한 편집 — 확장 계획 S-7. [편집] → [권한](직무 × 권한 표)과 [직원](개인 추가 권한)이 쓴다. route의 권한은 staff.manage.
 *
 * 설정으로 풀 수 없는 규칙(CHECKLIST.md S 절):
 * 1. 권한 관리 권한(staff.manage)을 가진 활성 직원이 0명이 되는 변경은 거부한다 — 변경 후 같은 트랜잭션에서 확인.
 * 2. 권한 변경은 감사 로그에 남는다(route가 무엇을 켜고 껐는지 코드로 남긴다). 감사 로그를 지우는 기능은 없다.
 * 3. 감사 로그·상태 이력의 수정·삭제 권한은 권한 목록에 없으므로 줄 수 없다(모르는 이름은 거부).
 * 4. 민감 권한을 새로 줄 때는 확인 표시(confirmSensitive)가 있어야 한다. 없으면 409로 멈추고 아무것도 바꾸지 않는다.
 * 권한에 영향을 주는 변경은 advisory lock으로 하나씩 한다.
 */

export type JobPermissionMatrix = Record<StaffRole, Permission[]>;

/** 지금 DB의 직무별 권한 (권한 목록 순서). 모르는 이름은 뺀다 */
export async function getJobPermissionMatrix(client: DbClient): Promise<JobPermissionMatrix> {
  const rows = await client.jobPermission.findMany({ select: { role: true, permission: true } });
  return Object.fromEntries(
    STAFF_ROLES.map((role) => {
      const granted = new Set(rows.filter((row) => row.role === role).map((row) => row.permission));
      return [role, PERMISSION_NAMES.filter((permission) => granted.has(permission))];
    }),
  ) as JobPermissionMatrix;
}

/** 민감 권한을 새로 주는데 확인 표시가 없으면 409 — 무엇을 주려는지(코드만) 돌려준다 */
export function assertSensitiveConfirmed(grants: string[], confirmed: boolean): void {
  const sensitive = grants.filter((grant) => isSensitivePermission(grant.slice(grant.indexOf(":") + 1)));
  if (sensitive.length > 0 && !confirmed) {
    throw new ApiError(409, "SENSITIVE_CONFIRM_REQUIRED", "민감 권한을 주려면 한 번 더 확인해야 합니다.", { grants: sensitive });
  }
}

function assertKnown(permissions: readonly string[]): void {
  const unknown = permissions.filter((permission) => !isPermission(permission));
  if (unknown.length > 0) throw new ApiError(400, "UNKNOWN_PERMISSION", "없는 권한 이름이 있습니다.", { unknown: unknown.slice(0, 5) });
}

/**
 * 직무 × 권한 표를 통째로 저장한다(다섯 직무 모두 보내야 한다 — route가 검사). 바뀐 칸만 지우고 넣는다.
 * 돌려주는 값: 켠 칸·끈 칸("직무:권한") — 감사 로그용.
 */
export async function saveJobPermissionMatrix(
  client: DbClient,
  next: Record<StaffRole, readonly string[]>,
  options: { confirmSensitive: boolean },
): Promise<{ added: string[]; removed: string[] }> {
  for (const role of STAFF_ROLES) assertKnown(next[role]);
  await lockPermissionChanges(client);
  const current = await getJobPermissionMatrix(client);
  const added: string[] = [];
  const removed: string[] = [];
  for (const role of STAFF_ROLES) {
    const want = new Set(next[role]);
    const have = new Set<string>(current[role]);
    for (const permission of PERMISSION_NAMES) {
      if (want.has(permission) && !have.has(permission)) added.push(`${role}:${permission}`);
      if (!want.has(permission) && have.has(permission)) removed.push(`${role}:${permission}`);
    }
  }
  assertSensitiveConfirmed(added, options.confirmSensitive);
  const split = (grant: string) => ({ role: grant.slice(0, grant.indexOf(":")) as StaffRole, permission: grant.slice(grant.indexOf(":") + 1) });
  if (removed.length > 0) {
    await client.jobPermission.deleteMany({ where: { OR: removed.map(split) } });
  }
  if (added.length > 0) await client.jobPermission.createMany({ data: added.map(split) });
  await assertPermissionManagerRemains(client);
  return { added, removed };
}

/** 개인 추가 권한 정리: 아는 이름만, 겹침 없이, 권한 목록 순서 */
export function normalizeExtras(extras: readonly string[]): Permission[] {
  assertKnown(extras);
  const set = new Set(extras);
  return PERMISSION_NAMES.filter((permission) => set.has(permission));
}

/** 추가 권한 변경에서 새로 준 것·뺀 것 — 민감 권한 확인과 감사 로그용 */
export function diffExtras(before: readonly string[], after: readonly Permission[]): { added: Permission[]; removed: string[] } {
  const kept = new Set<string>(after);
  const had = new Set(before);
  // 둘 다 권한 목록 순서로 (감사 로그를 읽기 쉽게). 모르는 이름이 저장돼 있었으면 뺀 것으로 센다
  return {
    added: after.filter((p) => !had.has(p)),
    removed: [...PERMISSION_NAMES.filter((p) => had.has(p) && !kept.has(p)), ...before.filter((p) => !isPermission(p))],
  };
}
