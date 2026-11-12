import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { setParticipants } from "@/server/surgery/service";

/** 수술 참여 직원 바꾸기 — F-11. 예약 상세에서 간호·의사 등을 고른다. 감사 행에는 인원 수만. */
export const PUT = defineRoute({
  permission: "surgery.record",
  audit: "SURGERY_PARTICIPANTS_UPDATE",
  params: z.object({ id: z.uuid() }),
  body: z.strictObject({ staffIds: z.array(z.uuid()).max(20) }),
  handler: async (ctx) => {
    ctx.audit({ appointmentId: ctx.params.id });
    const result = await setParticipants(ctx.db, ctx.params.id, ctx.body.staffIds);
    ctx.touchPatients([result.patientId]);
    ctx.audit({ participantCount: result.count });
    return { ok: true };
  },
});
