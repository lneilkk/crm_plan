import { z } from "zod";
import { APPOINTMENT_STATUSES, VISIT_REASON_CODES } from "@/lib/domain/appointment";
import { defineRoute } from "@/server/api/define-route";
import { ApiError } from "@/server/api/errors";
import { currentInputDevice, withInputDevice } from "@/server/appointments/input-device";
import { changeStatus } from "@/server/appointments/status";

/**
 * 내원 상태 변경 (T5-2, 기획서 4-3). 상태 변경과 visit_status_log 한 행이 한 트랜잭션이다.
 * expectedStatus는 화면이 보고 있던 상태 — 다르면 409 STATUS_CHANGED.
 * 예약변경은 새 예약을 함께 만들어야 하므로 여기서 받지 않는다(POST /api/appointments/[id]/reschedule).
 * 입력 기기는 요청 헤더 x-input-device로 받는다(input-device.ts).
 */
export const POST = withInputDevice(
  defineRoute({
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
        inputDevice: currentInputDevice(),
      });
      ctx.touchPatients([result.appointment.patientId]);
      return { appointment: result.appointment, isLate: result.isLate };
    },
  }),
);
