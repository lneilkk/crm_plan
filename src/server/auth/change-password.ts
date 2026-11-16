import "server-only";

import { checkPasswordPolicy, type PasswordRule } from "@/lib/auth/password-policy";
import type { DbClient } from "@/server/db";
import { MAX_FAILED_LOGINS } from "./login";
import { hashPassword, verifyPassword } from "./password";

/**
 * 비밀번호 변경 — F-1. 로그인한 직원이 자기 비밀번호를 바꾼다.
 *
 * - 현재 비밀번호를 다시 확인한다. 틀리면 로그인 실패와 같은 실패 횟수를 1 올리고, 5회째에 잠근다(login.ts와 같은 규칙).
 *   세션을 가로챈 사람이 이 화면으로 비밀번호를 대입해 보지 못하게 한다. 잠긴 계정은 맞는 비밀번호로도 바꿀 수 없다.
 * - 새 비밀번호는 checkPasswordPolicy(화면과 같은 규칙)를 통과해야 하고 지금과 달라야 한다.
 * - 바꾸면 같은 직원의 다른 세션(다른 PC)을 모두 끊는다. 지금 세션은 유지한다.
 * - client는 route의 ctx.db(감사 행과 같은 트랜잭션)다. 실패 결과도 커밋되도록 던지지 않고 결과로 돌려준다
 *   (던지면 트랜잭션이 취소되어 실패 횟수가 올라가지 않는다).
 * - 비밀번호 원문은 결과·로그·에러에 넣지 않는다.
 */

export type ChangePasswordInput = {
  staffId: string;
  sessionId: string;
  currentPassword: string;
  newPassword: string;
  now: Date;
};

export type ChangePasswordResult =
  | { ok: true; otherSessionsRevoked: number }
  | { ok: false; code: "ACCOUNT_LOCKED" | "SAME_AS_CURRENT" | "NOT_FOUND" }
  | { ok: false; code: "INVALID_CURRENT_PASSWORD"; failedCount: number; locked: boolean }
  | { ok: false; code: "WEAK_PASSWORD"; rules: PasswordRule[] };

export async function changePassword(client: DbClient, input: ChangePasswordInput): Promise<ChangePasswordResult> {
  const staff = await client.staff.findUnique({
    where: { id: input.staffId },
    select: { id: true, loginId: true, passwordHash: true, lockedAt: true, isActive: true },
  });
  if (!staff || !staff.isActive) return { ok: false, code: "NOT_FOUND" };
  if (staff.lockedAt !== null) return { ok: false, code: "ACCOUNT_LOCKED" };

  const rules = checkPasswordPolicy(input.newPassword, { loginId: staff.loginId });
  if (rules.length > 0) return { ok: false, code: "WEAK_PASSWORD", rules };

  if (!(await verifyPassword(staff.passwordHash, input.currentPassword))) {
    const [row] = await client.$queryRaw<{ failed_login_count: number; locked: boolean }[]>`
      UPDATE staff
      SET failed_login_count = failed_login_count + 1,
          locked_at = CASE
            WHEN locked_at IS NULL AND failed_login_count + 1 >= ${MAX_FAILED_LOGINS} THEN ${input.now}::timestamptz
            ELSE locked_at
          END,
          updated_at = ${input.now}::timestamptz
      WHERE id = ${staff.id}::uuid
      RETURNING failed_login_count, (locked_at IS NOT NULL) AS locked
    `;
    return { ok: false, code: "INVALID_CURRENT_PASSWORD", failedCount: row?.failed_login_count ?? 0, locked: row?.locked ?? false };
  }

  if (await verifyPassword(staff.passwordHash, input.newPassword)) return { ok: false, code: "SAME_AS_CURRENT" };

  const passwordHash = await hashPassword(input.newPassword);
  // 확인하는 사이에 잠겼으면 바꾸지 않는다.
  const updated = await client.staff.updateMany({
    where: { id: staff.id, lockedAt: null, isActive: true },
    data: { passwordHash, failedLoginCount: 0, updatedAt: input.now },
  });
  if (updated.count === 0) return { ok: false, code: "ACCOUNT_LOCKED" };

  const revoked = await client.session.updateMany({
    where: { staffId: staff.id, id: { not: input.sessionId }, revokedAt: null },
    data: { revokedAt: input.now },
  });
  return { ok: true, otherSessionsRevoked: revoked.count };
}
