import { z } from "zod";
import { MAX_LABELS_PER_APPOINTMENT } from "@/lib/calendar/colors";
import { defineRoute } from "@/server/api/define-route";
import { setAppointmentLabels } from "@/server/appointments/labels";

/** 예약에 붙은 색 라벨 바꾸기 — F-2. 예약을 쓸 수 있는 직원(프론트·상담·관리자). */
export const PUT = defineRoute({
  permission: "appointment.write",
  audit: "APPOINTMENT_LABELS_UPDATE",
  params: z.object({ id: z.uuid() }),
  body: z.strictObject({ labelIds: z.array(z.uuid()).max(MAX_LABELS_PER_APPOINTMENT) }),
  handler: async (ctx) => {
    ctx.audit({ appointmentId: ctx.params.id });
    const result = await setAppointmentLabels(ctx.db, ctx.params.id, ctx.body.labelIds);
    ctx.touchPatients([result.patientId]);
    ctx.audit({ labelCount: new Set(ctx.body.labelIds).size, added: result.added, removed: result.removed });
    return { labelIds: [...new Set(ctx.body.labelIds)] };
  },
});
