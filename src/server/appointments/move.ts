import "server-only";

import type { Appointment } from "@/generated/prisma/client";
import { isPendingStatus, PENDING_STATUSES } from "@/lib/domain/appointment";
import { kstDateKey } from "@/lib/time/kst";
import { ApiError } from "@/server/api/errors";
import { db } from "@/server/db";
import { assertChair, assertDuration, chairConflictError, endAtOf, isChairOverlapError } from "./create";
import { getClinicSettings } from "./settings";

/**
 * 캘린더에서 예약을 끌어 옮기기 — T4-1. 시간·체어·소요시간만 고치는 조정이며 '예약변경'(RESCHEDULED)이 아니다.
 * 상태 이력은 쓰지 않는다(상태가 바뀌지 않으므로). 예약 행은 추가 전용 테이블이 아니라 고칠 수 있다.
 *
 * - 대기 상태(BOOKED·CONFIRMED)인 예약만, 오늘(한국 시간) 이후 날짜로만 옮길 수 있다.
 * - 같은 체어·겹치는 시간은 DB 제약이 막고 409 CHAIR_CONFLICT로 바꾼다.
 */

export type MoveAppointmentInput = { id: string; startAt: Date; chair?: string; durationMin?: number; now: Date };

export async function moveAppointment(input: MoveAppointmentInput): Promise<{ before: Appointment; after: Appointment }> {
  const before = await db.appointment.findUnique({ where: { id: input.id } });
  if (!before) throw new ApiError(404, "NOT_FOUND", "예약을 찾을 수 없습니다.");
  if (!isPendingStatus(before.status)) {
    throw new ApiError(409, "INVALID_STATUS", "예약확정·확인완료 상태의 예약만 옮길 수 있습니다.");
  }
  if (kstDateKey(input.startAt) < kstDateKey(input.now)) {
    throw new ApiError(400, "PAST_DATE", "지난 날짜로는 옮길 수 없습니다.");
  }

  const chair = input.chair ?? before.chair;
  const durationMin = input.durationMin ?? before.durationMin;
  if (input.chair !== undefined) assertChair(await getClinicSettings(), chair);
  assertDuration(durationMin);

  try {
    // 읽은 뒤 다른 사람이 상태를 바꿨으면(내원·취소 등) 옮기지 않는다.
    const { count } = await db.appointment.updateMany({
      where: { id: before.id, status: { in: [...PENDING_STATUSES] } },
      data: { startAt: input.startAt, endAt: endAtOf(input.startAt, durationMin), chair, durationMin },
    });
    if (count === 0) throw new ApiError(409, "INVALID_STATUS", "예약확정·확인완료 상태의 예약만 옮길 수 있습니다.");
  } catch (error) {
    if (isChairOverlapError(error)) throw chairConflictError();
    throw error;
  }
  const after = await db.appointment.findUniqueOrThrow({ where: { id: before.id } });
  return { before, after };
}
