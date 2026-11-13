import "server-only";

import { checkPasswordPolicy } from "@/lib/auth/password-policy";
import type { StaffRole } from "@/lib/domain/staff";
import { ApiError } from "@/server/api/errors";
import { assertPermissionManagerRemains, lockPermissionChanges } from "@/server/auth/access";
import { hashPassword } from "@/server/auth/password";
import type { DbClient } from "@/server/db";

/**
 * 직원 계정 관리 — F-14(Task.md T2-5 일부), 관리자만(route의 staff.manage).
 * - 비활성화하면 그 직원의 세션을 바로 끊는다(T2-5 완료 기준). 직원은 지우지 않는다(기록 보존).
 * - 비밀번호 초기화: 관리자가 정한 임시 비밀번호(비밀번호 규칙 적용), 잠금 해제, 기존 세션 끊기.
 * - 자기 자신의 역할을 바꾸거나 비활성화할 수 없다.
 * - 권한 관리 권한(staff.manage)을 가진 활성 직원이 0명이 되는 변경은 거부한다(S-2b, 설정으로 풀 수 없음).
 *   직무 이름이 아니라 실제 권한(DB 직무 권한 ∪ 개인 추가 권한)으로 센다. 변경 후 같은 트랜잭션에서 확인하고 실패하면 되돌린다.
 * - 역할 변경 이력은 감사 로그(STAFF_UPDATE, fromRole→toRole)에 남는다.
 * - 비밀번호 원문은 어디에도 남기지 않는다.
 */

export const LOGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;

export type StaffAccount = {
  id: string;
  loginId: string;
  name: string;
  role: StaffRole;
  isActive: boolean;
  locked: boolean;
  lastLoginAt: string | null;
};

export async function listStaffAccounts(client: DbClient): Promise<StaffAccount[]> {
  const rows = await client.staff.findMany({
    select: { id: true, loginId: true, name: true, role: true, isActive: true, lockedAt: true, lastLoginAt: true },
    orderBy: [{ isActive: "desc" }, { role: "asc" }, { name: "asc" }],
  });
  return rows.map(({ lockedAt, lastLoginAt, ...row }) => ({
    ...row,
    locked: lockedAt !== null,
    lastLoginAt: lastLoginAt?.toISOString() ?? null,
  }));
}

function assertPassword(password: string, loginId: string): void {
  const rules = checkPasswordPolicy(password, { loginId });
  if (rules.length > 0) throw new ApiError(400, "WEAK_PASSWORD", "비밀번호가 규칙에 맞지 않습니다.", { rules });
}

export async function createStaffAccount(
  client: DbClient,
  input: { loginId: string; name: string; role: StaffRole; password: string },
): Promise<{ id: string }> {
  const loginId = input.loginId.trim().toLowerCase();
  if (!LOGIN_ID_RE.test(loginId)) throw new ApiError(400, "INVALID_LOGIN_ID", "아이디는 영문 소문자·숫자·. _ - 로 3~30자입니다.");
  assertPassword(input.password, loginId);
  if (await client.staff.findUnique({ where: { loginId }, select: { id: true } })) {
    throw new ApiError(409, "LOGIN_ID_TAKEN", "이미 쓰는 아이디입니다.");
  }
  const created = await client.staff.create({
    data: { loginId, name: input.name.trim(), role: input.role, passwordHash: await hashPassword(input.password) },
    select: { id: true },
  });
  return created;
}

export type UpdateStaffInput = { name?: string; role?: StaffRole; isActive?: boolean; password?: string };

export async function updateStaffAccount(
  client: DbClient,
  actorId: string,
  id: string,
  input: UpdateStaffInput,
  now: Date,
): Promise<{ fromRole: StaffRole; toRole: StaffRole; sessionsRevoked: number }> {
  const staff = await client.staff.findUnique({ where: { id }, select: { id: true, loginId: true, role: true, isActive: true } });
  if (!staff) throw new ApiError(404, "NOT_FOUND", "직원을 찾을 수 없습니다.");
  const self = id === actorId;
  if (self && input.isActive === false) throw new ApiError(409, "CANNOT_CHANGE_SELF", "자기 계정은 비활성화할 수 없습니다.");
  if (self && input.role !== undefined && input.role !== staff.role) {
    throw new ApiError(409, "CANNOT_CHANGE_SELF", "자기 계정의 역할은 바꿀 수 없습니다.");
  }
  if (input.password !== undefined) assertPassword(input.password, staff.loginId);
  const affectsPermissions = input.isActive !== undefined || (input.role !== undefined && input.role !== staff.role);
  if (affectsPermissions) await lockPermissionChanges(client);

  await client.staff.update({
    where: { id },
    data: {
      name: input.name?.trim(),
      role: input.role,
      isActive: input.isActive,
      ...(input.password !== undefined
        ? { passwordHash: await hashPassword(input.password), failedLoginCount: 0, lockedAt: null }
        : {}),
    },
  });
  if (affectsPermissions) await assertPermissionManagerRemains(client);
  // 비활성화·비밀번호 초기화는 그 직원의 열린 세션을 모두 끊는다.
  let sessionsRevoked = 0;
  if (input.isActive === false || input.password !== undefined) {
    const revoked = await client.session.updateMany({ where: { staffId: id, revokedAt: null }, data: { revokedAt: now } });
    sessionsRevoked = revoked.count;
  }
  return { fromRole: staff.role, toRole: input.role ?? staff.role, sessionsRevoked };
}
