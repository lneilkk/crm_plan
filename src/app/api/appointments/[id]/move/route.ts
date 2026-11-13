import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { isOnSlotBoundary } from "@/server/appointments/create";
import { moveAppointment } from "@/server/appointments/move";
import { appointmentPatientId } from "@/server/appointments/status";
import { appointmentForViewer } from "@/server/appointments/price";

/**
 * 캘린더 끌어 옮기기 — T4-1. 같은 날 안의 시간·체어·소요시간 조정이며 예약변경(RESCHEDULED)이 아니라 상태 이력을 쓰지 않는다.
 * 지난 날의 예약은 409 PAST_APPOINTMENT, 날짜를 바꾸면 400 USE_RESCHEDULE (move.ts).
 */
export const PATCH = defineRoute({
  permission: "appointment.write",
  audit: "APPOINTMENT_MOVE",
  params: z.object({ id: z.uuid() }),
  body: z.strictObject({
    startAt: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value))
      .refine(isOnSlotBoundary, { message: "slot" }),
    chair: z.string().min(1).max(20).optional(),
    durationMin: z.number().int().optional(),
  }),
  handler: async (ctx) => {
    // 실패한 시도의 감사 행에도 예약·대상 고객이 남도록 먼저 알린다.
    ctx.audit({ appointmentId: ctx.params.id });
    const patientId = await appointmentPatientId(ctx.db, ctx.params.id);
    if (patientId) ctx.touchPatients([patientId]);
    const { before, after } = await moveAppointment({ id: ctx.params.id, ...ctx.body, now: ctx.now }, ctx.db);
    ctx.audit({
      fromStartAt: before.startAt.toISOString(),
      toStartAt: after.startAt.toISOString(),
      fromChair: before.chair,
      chair: after.chair,
    });
    return { appointment: appointmentForViewer(ctx.staff, after) };
  },
});
