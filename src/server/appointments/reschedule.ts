import "server-only";

import type { AppointmentStatus } from "@/lib/domain/appointment";
import { kstDateKey } from "@/lib/time/kst";
import { ApiError } from "@/server/api/errors";
import { db } from "@/server/db";
import { createAppointment, invalidField, isOnSlotBoundary } from "./create";
import { changeStatus, lockAppointment, type StatusActor } from "./status";

/**
 * 예약변경 — T5-2 (기획서 4-1 '예약변경'). 한 트랜잭션에서
 *   1. 원 예약을 RESCHEDULED로 바꾸고(changeStatus, 이력 한 행),
 *   2. 원 예약 id를 가진 새 예약을 만든다(createAppointment, 첫 이력 행).
 * 원 예약이 먼저 자리를 비우므로 같은 체어에서 시간만 조금 옮기는 것도 된다.
 * 새 자리가 다른 예약과 겹치면(409 CHAIR_CONFLICT) 둘 다 되돌려진다.
 * 같은 환자, 채널·메모는 원 예약 그대로. 나머지 값은 주지 않으면 원 예약 값을 쓴다.
 * 원장·상담 담당자가 그만두었으면(비활성) 그대로 옮길 수 없으니 doctorId/counselorId를 null이나 다른 사람으로 보낸다.
 * 예약변경 상태에서는 나가는 전환이 없으므로 한 예약에서 새 예약은 하나뿐이다(original_appointment_id unique).
 */

export type RescheduleInput = {
  appointmentId: string;
  startAt: Date;
  durationMin?: number;
  chair?: string;
  doctorId?: string | null;
  counselorId?: string | null;
  treatmentItem?: string;
  expectedStatus: AppointmentStatus;
  actor: StatusActor;
  now: Date;
  inputDevice?: string | null;
};

export async function rescheduleAppointment(input: RescheduleInput) {
  if (!isOnSlotBoundary(input.startAt)) throw invalidField("startAt", "not_on_slot");
  // 캘린더 옮기기(move.ts)와 같은 규칙: 오늘(한국 시간) 이전 날짜로는 바꿀 수 없다
  if (kstDateKey(input.startAt) < kstDateKey(input.now)) {
    throw new ApiError(400, "PAST_DATE", "지난 날짜로는 예약을 바꿀 수 없습니다.");
  }
  return db.$transaction(async (tx) => {
    await lockAppointment(tx, input.appointmentId);
    const original = await tx.appointment.findUniqueOrThrow({
      where: { id: input.appointmentId },
      select: {
        patientId: true,
        durationMin: true,
        chair: true,
        doctorId: true,
        counselorId: true,
        treatmentItem: true,
        channel: true,
        memo: true,
      },
    });

    const changed = await changeStatus(
      {
        appointmentId: input.appointmentId,
        to: "RESCHEDULED",
        expectedStatus: input.expectedStatus,
        actor: input.actor,
        now: input.now,
        inputDevice: input.inputDevice,
      },
      tx,
    );

    const created = await createAppointment(
      {
        patientId: original.patientId,
        startAt: input.startAt,
        durationMin: input.durationMin ?? original.durationMin,
        chair: input.chair ?? original.chair,
        doctorId: input.doctorId !== undefined ? input.doctorId : original.doctorId,
        counselorId: input.counselorId !== undefined ? input.counselorId : original.counselorId,
        treatmentItem: input.treatmentItem ?? original.treatmentItem,
        channel: original.channel,
        memo: original.memo,
      },
      { actorId: input.actor.id, inputDevice: input.inputDevice, originalAppointmentId: input.appointmentId, tx },
    );

    return {
      original: changed.appointment,
      appointment: {
        id: created.id,
        patientId: created.patientId,
        status: created.status,
        startAt: created.startAt,
        durationMin: created.durationMin,
        chair: created.chair,
        doctorId: created.doctorId,
        counselorId: created.counselorId,
        treatmentItem: created.treatmentItem,
        channel: created.channel,
        originalAppointmentId: created.originalAppointmentId,
      },
    };
  });
}
