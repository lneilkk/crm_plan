import { z } from "zod";
import { APPOINTMENT_STATUSES } from "@/lib/domain/appointment";
import { defineRoute } from "@/server/api/define-route";
import { currentInputDevice, withInputDevice } from "@/server/appointments/input-device";
import { rescheduleAppointment } from "@/server/appointments/reschedule";

/**
 * 예약변경 (T5-2). 원 예약을 '예약변경'으로 바꾸고 원 예약 id를 가진 새 예약을 한 트랜잭션에 만든다.
 * 새 자리가 겹치면 409 CHAIR_CONFLICT이고 원 예약도 그대로다. 입력 기기는 요청 헤더 x-input-device로 받는다.
 */
export const POST = withInputDevice(
  defineRoute({
    permission: "appointment.write",
    audit: "APPOINTMENT_RESCHEDULE",
    params: z.object({ id: z.uuid() }),
    body: z.object({
      startAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
      durationMin: z.number().int().optional(),
      chair: z.string().min(1).max(20).optional(),
      doctorId: z.uuid().nullish(),
      counselorId: z.uuid().nullish(),
      treatmentItem: z.string().min(1).max(50).optional(),
      expectedStatus: z.enum(APPOINTMENT_STATUSES),
    }),
    handler: async (ctx) => {
      ctx.audit({ appointmentId: ctx.params.id, fromStatus: ctx.body.expectedStatus });
      const result = await rescheduleAppointment({
        appointmentId: ctx.params.id,
        startAt: ctx.body.startAt,
        durationMin: ctx.body.durationMin,
        chair: ctx.body.chair,
        doctorId: ctx.body.doctorId,
        counselorId: ctx.body.counselorId,
        treatmentItem: ctx.body.treatmentItem,
        expectedStatus: ctx.body.expectedStatus,
        actor: ctx.staff,
        now: ctx.now,
        inputDevice: currentInputDevice(),
      });
      ctx.touchPatients([result.appointment.patientId]);
      ctx.audit({ newAppointmentId: result.appointment.id });
      return result;
    },
  }),
);
