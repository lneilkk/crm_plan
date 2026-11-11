import { z } from "zod";
import { APPOINTMENT_STATUSES } from "@/lib/domain/appointment";
import { defineRoute } from "@/server/api/define-route";
import { appointmentPatientId, revertStatus } from "@/server/appointments/status";

/**
 * 상태 되돌리기 (T5-2, 보드의 5초 되돌리기와 이후 정정). 최신 이력의 이전 상태로 되돌린다.
 * 되돌리기도 이력 한 행으로 남는다(이력은 추가만 한다). 입력 기기는 ctx.inputDevice(요청 헤더 x-input-device)다.
 */
export const POST = defineRoute({
  permission: "visit.write",
  audit: "VISIT_STATUS_REVERT",
  params: z.object({ id: z.uuid() }),
  body: z.object({
    expectedStatus: z.enum(APPOINTMENT_STATUSES),
  }),
  handler: async (ctx) => {
    ctx.audit({ appointmentId: ctx.params.id, fromStatus: ctx.body.expectedStatus });
    // 실패한 시도의 감사 행에도 대상 고객이 남도록 먼저 알린다.
    const patientId = await appointmentPatientId(ctx.db, ctx.params.id);
    if (patientId) ctx.touchPatients([patientId]);
    const result = await revertStatus({
      appointmentId: ctx.params.id,
      expectedStatus: ctx.body.expectedStatus,
      actor: ctx.staff,
      now: ctx.now,
      inputDevice: ctx.inputDevice,
    }, ctx.db);
    ctx.audit({ toStatus: result.appointment.status });
    return { appointment: result.appointment, isLate: result.isLate };
  },
});
