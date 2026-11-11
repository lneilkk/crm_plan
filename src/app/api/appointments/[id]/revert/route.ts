import { z } from "zod";
import { APPOINTMENT_STATUSES } from "@/lib/domain/appointment";
import { defineRoute } from "@/server/api/define-route";
import { currentInputDevice, withInputDevice } from "@/server/appointments/input-device";
import { revertStatus } from "@/server/appointments/status";

/**
 * 상태 되돌리기 (T5-2, 보드의 5초 되돌리기와 이후 정정). 최신 이력의 이전 상태로 되돌린다.
 * 되돌리기도 이력 한 행으로 남는다(이력은 추가만 한다). 입력 기기는 요청 헤더 x-input-device로 받는다.
 */
export const POST = withInputDevice(
  defineRoute({
    permission: "visit.write",
    audit: "VISIT_STATUS_REVERT",
    params: z.object({ id: z.uuid() }),
    body: z.object({
      expectedStatus: z.enum(APPOINTMENT_STATUSES),
    }),
    handler: async (ctx) => {
      ctx.audit({ appointmentId: ctx.params.id, fromStatus: ctx.body.expectedStatus });
      const result = await revertStatus({
        appointmentId: ctx.params.id,
        expectedStatus: ctx.body.expectedStatus,
        actor: ctx.staff,
        now: ctx.now,
        inputDevice: currentInputDevice(),
      });
      ctx.touchPatients([result.appointment.patientId]);
      ctx.audit({ toStatus: result.appointment.status });
      return { appointment: result.appointment, isLate: result.isLate };
    },
  }),
);
