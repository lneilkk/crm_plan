import "server-only";

import { writeAudit } from "@/server/api/audit";
import type { DbClient } from "@/server/db";

/**
 * 계정 잠금 해제 — T2-1. 잠금 시각과 연속 실패 횟수를 지운다.
 * 관리자 화면(POST /api/staff/[id]/unlock)과 운영자 명령(scripts/ops/staff-unlock.ts)이 함께 쓴다.
 * 잠금은 세션을 끊지 않으므로(session.ts) 해제할 때도 세션은 건드리지 않는다.
 */

/** 해제했으면 true, 그런 직원이 없으면 false */
export async function unlockStaff(client: DbClient, staffId: string): Promise<boolean> {
  const { count } = await client.staff.updateMany({
    where: { id: staffId },
    data: { lockedAt: null, failedLoginCount: 0 },
  });
  return count > 0;
}

export type UnlockByLoginIdResult = { ok: true; staffId: string; wasLocked: boolean } | { ok: false; reason: "NOT_FOUND" };

/**
 * 운영자 명령용 — 관리자 계정이 모두 잠겨 화면에서 해제할 사람이 없을 때 서버에서 직접 푼다.
 * 해제와 감사 행(STAFF_UNLOCK, staff_id 없음, detail.via = "CLI")을 한 트랜잭션에 쓴다.
 */
export async function unlockStaffByLoginId(
  db: { $transaction<T>(work: (tx: DbClient) => Promise<T>): Promise<T> },
  loginId: string,
): Promise<UnlockByLoginIdResult> {
  return db.$transaction(async (tx) => {
    const staff = await tx.staff.findUnique({ where: { loginId }, select: { id: true, lockedAt: true } });
    if (!staff) return { ok: false, reason: "NOT_FOUND" } as const;
    await unlockStaff(tx, staff.id);
    const wasLocked = staff.lockedAt !== null;
    await writeAudit(
      {
        staffId: null,
        action: "STAFF_UNLOCK",
        result: "SUCCESS",
        detail: { targetStaffId: staff.id, via: "CLI", wasLocked },
      },
      tx,
    );
    return { ok: true, staffId: staff.id, wasLocked } as const;
  });
}
