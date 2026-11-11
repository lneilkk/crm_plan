import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { isOnSlotBoundary } from "@/server/appointments/create";
import { moveAppointment } from "@/server/appointments/move";

/** 캘린더 끌어 옮기기 — T4-1. 시간·체어·소요시간 조정이며 예약변경(RESCHEDULED)이 아니라 상태 이력을 쓰지 않는다. */
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
    const { before, after } = await moveAppointment({ id: ctx.params.id, ...ctx.body, now: ctx.now });
    ctx.touchPatients([after.patientId]);
    ctx.audit({
      appointmentId: after.id,
      fromStartAt: before.startAt.toISOString(),
      toStartAt: after.startAt.toISOString(),
      fromChair: before.chair,
      chair: after.chair,
    });
    return { appointment: after };
  },
});
