import { z } from "zod";
import { APPOINTMENT_STATUSES, VISIT_REASON_CODES } from "@/lib/domain/appointment";
import { defineRoute } from "@/server/api/define-route";
import { ApiError } from "@/server/api/errors";
import { appointmentPatientId, changeStatus } from "@/server/appointments/status";

/**
 * 내원 상태 변경 (T5-2, 기획서 4-3). 상태 변경과 visit_status_log 한 행이 한 트랜잭션이다.
 * expectedStatus는 화면이 보고 있던 상태 — 다르면 409 STATUS_CHANGED.
 * 예약변경은 새 예약을 함께 만들어야 하므로 여기서 받지 않는다(POST /api/appointments/[id]/reschedule).
 * 입력 기기는 ctx.inputDevice(요청 헤더 x-input-device)다.
 */
export const POST = defineRoute({
  permission: "visit.write",
  audit: "VISIT_STATUS_CHANGE",
  params: z.object({ id: z.uuid() }),
  body: z.object({
    to: z.enum(APPOINTMENT_STATUSES),
    reasonCode: z.enum(VISIT_REASON_CODES).nullish(),
    expectedStatus: z.enum(APPOINTMENT_STATUSES),
  }),
  handler: async (ctx) => {
    ctx.audit({ appointmentId: ctx.params.id, fromStatus: ctx.body.expectedStatus, toStatus: ctx.body.to });
    // 실패한 시도의 감사 행에도 대상 고객이 남도록 먼저 알린다.
    const patientId = await appointmentPatientId(ctx.db, ctx.params.id);
    if (patientId) ctx.touchPatients([patientId]);
    if (ctx.body.to === "RESCHEDULED") {
      throw new ApiError(400, "USE_RESCHEDULE", "예약변경은 [변경]에서 새 일시를 정해 처리하세요.");
    }
    const result = await changeStatus({
      appointmentId: ctx.params.id,
      to: ctx.body.to,
      reasonCode: ctx.body.reasonCode,
      expectedStatus: ctx.body.expectedStatus,
      actor: ctx.staff,
      now: ctx.now,
      inputDevice: ctx.inputDevice,
    }, ctx.db);
    return { appointment: result.appointment, isLate: result.isLate };
  },
});
