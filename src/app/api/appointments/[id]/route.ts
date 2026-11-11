import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { getAppointmentDetail } from "@/server/appointments/query";

/** 예약 한 건 상세와 상태 이력 — T4-1 */
export const GET = defineRoute({
  permission: "appointment.read",
  audit: "APPOINTMENT_READ",
  params: z.object({ id: z.uuid() }),
  handler: async (ctx) => {
    const appointment = await getAppointmentDetail(ctx.params.id);
    ctx.touchPatients([appointment.patientId]);
    ctx.audit({ appointmentId: appointment.id });
    return { appointment };
  },
});
