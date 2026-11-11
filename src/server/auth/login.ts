import "server-only";

import type { StaffRole } from "@/lib/domain/staff";
import { type AuditDetail, writeAudit } from "@/server/api/audit";
import { db } from "@/server/db";
import { verifyPassword } from "./password";
import { createSession, revokeSessionByToken } from "./session";

/**
 * 로그인 — T2-1, 기획서 10장(5회 실패 시 잠금).
 *
 * - argon2id 검증. 틀리면 failed_login_count를 원자적으로 1 올리고(UPDATE … RETURNING),
 *   5가 되면 locked_at을 채운다. 동시에 여러 번 시도해도 5회를 넘겨 몰래 시도할 수 없다.
 * - 잠긴 계정은 비밀번호가 맞아도 거부한다. 해제는 관리자(POST /api/staff/[id]/unlock)만 한다.
 * - 없는 아이디도 고정된 가짜 해시로 검증을 한 번 돌려, 응답 시간으로 계정 존재를 알 수 없게 한다.
 *   없는 아이디·틀린 비밀번호·비활성 계정은 같은 문구로 답하고, DB 작업도 같은 모양으로 한다
 *   (recordFailure: 한 트랜잭션 안에서 실패 횟수 UPDATE 한 번 + 감사 INSERT 한 번 → 커밋 한 번).
 *   없는 아이디는 어느 행에도 맞지 않는 UPDATE를 같은 색인으로 돌린다. 쓰기 횟수가 다르면 커밋(WAL 기록)
 *   시간 차이로 계정 존재가 드러난다(검토에서 약 5ms 차이를 측정함).
 * - 잠긴 계정은 "잠겼다"고 알려 준다(423). 아이디가 있다는 사실이 드러나지만, 직원이 이유를 알고
 *   관리자에게 해제를 요청할 수 있어야 하므로 받아들인다. 잠긴 계정에는 더 이상 비밀번호를 대입할 수 없다.
 * - 비밀번호 원문은 어디에도(로그·감사 로그·에러·응답) 넣지 않는다. 감사 행에는 결과와 사유 코드만 남긴다.
 * - 감사 행은 이 모듈이 직접 쓴다: 요청 전에는 누가 로그인하는지 몰라 defineRoute가 쓸 수 없다.
 * - 잠금은 새 로그인만 막는다. 이미 로그인한 세션은 끊지 않는다(session.ts 설명).
 * - 로그인에 성공하면 브라우저가 보낸 이전 세션(meta.previousToken)을 끊는다. 공용 PC에서 직원 B가 로그인한 뒤
 *   직원 A의 세션 토큰이 12시간 동안 살아 있지 않게 한다. 감사 행 detail에 previousSessionRevoked로 남긴다.
 */

export const MAX_FAILED_LOGINS = 5;

/**
 * 없는 아이디일 때 검증에 쓰는 고정 해시. 같은 argon2id 파라미터로 무작위 64자를 해시하고 원문은 버렸다
 * (비밀값이 아니며 어떤 비밀번호와도 맞지 않는다). login.test.ts가 실제 검증 비용이 드는지 확인한다.
 */
export const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$D9XQ5bXjJoOANr/IMxpHFg$6duMEow0FLQ2df0Zl6Amf8NeKt4mhZ/8WlUS8d2VpCU";

export type LoginInput = { loginId: string; password: string };
export type LoginMeta = {
  ip: string | null;
  userAgent: string | null;
  now: Date;
  /** 요청 쿠키에 있던 세션 토큰(있으면). 로그인에 성공하면 끊는다. */
  previousToken?: string | null;
};

export type LoginResult =
  | {
      ok: true;
      staff: { id: string; name: string; role: StaffRole; loginId: string };
      token: string;
      expiresAt: Date;
    }
  | { ok: false; reason: "INVALID_CREDENTIALS" | "LOCKED" };

const ACTION = "AUTH_LOGIN";

export async function login(input: LoginInput, meta: LoginMeta): Promise<LoginResult> {
  const audit = (staffId: string | null, result: "SUCCESS" | "FAILED" | "DENIED", detail: Record<string, string | number | boolean>) =>
    writeAudit({ staffId, action: ACTION, result, ip: meta.ip, userAgent: meta.userAgent, detail });

  const staff = await db.staff.findUnique({
    where: { loginId: input.loginId },
    select: { id: true, name: true, role: true, loginId: true, passwordHash: true, isActive: true, lockedAt: true },
  });

  if (!staff) {
    await verifyPassword(DUMMY_PASSWORD_HASH, input.password);
    await recordFailure(null, meta);
    return { ok: false, reason: "INVALID_CREDENTIALS" };
  }

  if (staff.lockedAt !== null) {
    await audit(staff.id, "DENIED", { reason: "LOCKED" });
    return { ok: false, reason: "LOCKED" };
  }

  const passwordOk = await verifyPassword(staff.passwordHash, input.password);

  if (!staff.isActive || !passwordOk) {
    const locked = await recordFailure(staff, meta);
    return { ok: false, reason: locked ? "LOCKED" : "INVALID_CREDENTIALS" };
  }

  // 검증 사이에 잠겼을 수 있으므로 잠기지 않은 경우에만 실패 횟수를 지운다.
  const reset = await db.staff.updateMany({
    where: { id: staff.id, lockedAt: null, isActive: true },
    data: { failedLoginCount: 0, lastLoginAt: meta.now },
  });
  if (reset.count === 0) {
    await audit(staff.id, "DENIED", { reason: "LOCKED" });
    return { ok: false, reason: "LOCKED" };
  }

  const previousSessionRevoked = meta.previousToken ? await revokeSessionByToken(meta.previousToken, meta.now) : false;
  const session = await createSession(staff.id, meta);
  await audit(staff.id, "SUCCESS", previousSessionRevoked ? { previousSessionRevoked } : {});
  return {
    ok: true,
    staff: { id: staff.id, name: staff.name, role: staff.role, loginId: staff.loginId },
    token: session.token,
    expiresAt: session.expiresAt,
  };
}

/** 없는 아이디용: 어떤 직원과도 맞지 않는 id. 실제 계정과 같은 기본 키 색인 조회를 하게 한다. */
const NO_STAFF_ID = "00000000-0000-0000-0000-000000000000";

/**
 * 실패한 로그인 기록 — 없는 아이디·비활성 계정·틀린 비밀번호가 모두 이 함수 하나를 거쳐
 * 같은 DB 작업(트랜잭션 1개: UPDATE 1번 + 감사 INSERT 1번)을 한다. 잠겼으면 true.
 * 실패 횟수는 원자적으로 올린다. SET 절의 failed_login_count는 갱신 전 값이다.
 * 비활성 계정과 없는 아이디는 WHERE에 걸리지 않아 아무 행도 바뀌지 않는다.
 */
async function recordFailure(
  staff: { id: string; isActive: boolean } | null,
  meta: LoginMeta,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ failed_login_count: number; locked: boolean }[]>`
      UPDATE staff
      SET failed_login_count = failed_login_count + 1,
          locked_at = CASE
            WHEN locked_at IS NULL AND failed_login_count + 1 >= ${MAX_FAILED_LOGINS} THEN ${meta.now}::timestamptz
            ELSE locked_at
          END,
          updated_at = ${meta.now}::timestamptz
      WHERE id = ${staff?.id ?? NO_STAFF_ID}::uuid AND is_active
      RETURNING failed_login_count, (locked_at IS NOT NULL) AS locked
    `;
    const locked = row?.locked ?? false;
    const detail: AuditDetail = !staff
      ? { reason: "UNKNOWN_LOGIN_ID" }
      : !staff.isActive
        ? { reason: "INACTIVE" }
        : { reason: "BAD_PASSWORD", failedCount: row?.failed_login_count ?? 0, locked };
    await writeAudit(
      { staffId: staff?.id ?? null, action: ACTION, result: "FAILED", ip: meta.ip, userAgent: meta.userAgent, detail },
      tx,
    );
    return locked;
  });
}
