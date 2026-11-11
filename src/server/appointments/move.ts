import "server-only";

import type { Appointment } from "@/generated/prisma/client";
import { isPendingStatus, PENDING_STATUSES } from "@/lib/domain/appointment";
import { kstDateKey } from "@/lib/time/kst";
import { ApiError } from "@/server/api/errors";
import { db, type DbClient } from "@/server/db";
import { assertChair, assertDuration, chairConflictError, endAtOf, isChairOverlapError } from "./create";
import { getClinicSettings } from "./settings";

/**
 * 캘린더에서 예약을 끌어 옮기기 — T4-1. 같은 날 안에서 시간·체어·소요시간만 고치는 조정이며 '예약변경'(RESCHEDULED)이 아니다.
 * 상태 이력은 쓰지 않는다(상태가 바뀌지 않으므로). 예약 행은 추가 전용 테이블이 아니라 고칠 수 있다.
 *
 * - 대기 상태(BOOKED·CONFIRMED)인 예약만 옮길 수 있다.
 * - 지난 날(한국 시간)의 예약은 옮길 수 없다(409 PAST_APPOINTMENT). 지난 예약은 내원 보드에서 노쇼·취소·변경으로 정리한다
 *   — 옮겨 버리면 노쇼가 기록되지 않고 그날 통계의 분모에서도 빠진다.
 * - 날짜를 바꾸는 것은 기획서 4-1의 '예약변경'(원 예약과 연결된 새 예약)이므로 여기서 받지 않는다
 *   (400 USE_RESCHEDULE → POST /api/appointments/[id]/reschedule).
 * - 같은 체어·겹치는 시간은 DB 제약이 막고 409 CHAIR_CONFLICT로 바꾼다.
 * - client는 route가 넘긴 ctx.db(감사 행과 같은 트랜잭션)다.
 */

export type MoveAppointmentInput = { id: string; startAt: Date; chair?: string; durationMin?: number; now: Date };

const PENDING_ONLY_MESSAGE = "예약확정·확인완료 상태의 예약만 옮길 수 있습니다.";

export async function moveAppointment(
  input: MoveAppointmentInput,
  client: DbClient = db,
): Promise<{ before: Appointment; after: Appointment }> {
  const before = await client.appointment.findUnique({ where: { id: input.id } });
  if (!before) throw new ApiError(404, "NOT_FOUND", "예약을 찾을 수 없습니다.");
  if (!isPendingStatus(before.status)) throw new ApiError(409, "INVALID_STATUS", PENDING_ONLY_MESSAGE);
  const today = kstDateKey(input.now);
  const fromDay = kstDateKey(before.startAt);
  if (fromDay < today) {
    throw new ApiError(409, "PAST_APPOINTMENT", "지난 날의 예약은 옮길 수 없습니다. 내원 보드에서 노쇼·취소·변경으로 정리하세요.");
  }
  if (kstDateKey(input.startAt) !== fromDay) {
    throw new ApiError(400, "USE_RESCHEDULE", "날짜를 바꾸려면 예약변경으로 처리하세요.");
  }

  const chair = input.chair ?? before.chair;
  const durationMin = input.durationMin ?? before.durationMin;
  if (input.chair !== undefined) assertChair(await getClinicSettings(client), chair);
  assertDuration(durationMin);

  try {
    // 읽은 뒤 다른 사람이 상태를 바꿨으면(내원·취소 등) 옮기지 않는다.
    const { count } = await client.appointment.updateMany({
      where: { id: before.id, status: { in: [...PENDING_STATUSES] } },
      data: { startAt: input.startAt, endAt: endAtOf(input.startAt, durationMin), chair, durationMin },
    });
    if (count === 0) throw new ApiError(409, "INVALID_STATUS", PENDING_ONLY_MESSAGE);
  } catch (error) {
    if (isChairOverlapError(error)) throw chairConflictError();
    throw error;
  }
  const after = await client.appointment.findUniqueOrThrow({ where: { id: before.id } });
  return { before, after };
}
