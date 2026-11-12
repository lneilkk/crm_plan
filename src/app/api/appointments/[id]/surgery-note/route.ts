import { z } from "zod";
import { containsResidentRegistrationNumber, RRN_FIELD_CODE } from "@/lib/validation/forbidden-text";
import { defineRoute } from "@/server/api/define-route";
import { getSurgeryNote, saveSurgeryNote } from "@/server/surgery/service";

/**
 * 수술 메모 — F-11. 수술 중 실수 등 직원 관련 메모. 원장·관리자만(surgery.note) 보고 쓴다.
 * 조회·저장마다 감사 행(내용은 남기지 않음). 진단·처방·주민번호는 적지 않는다(절대 규칙 3).
 */
export const GET = defineRoute({
  permission: "surgery.note",
  audit: "SURGERY_NOTE_READ",
  params: z.object({ id: z.uuid() }),
  handler: async (ctx) => {
    const { patientId, note } = await getSurgeryNote(ctx.db, ctx.params.id);
    ctx.touchPatients([patientId]);
    ctx.audit({ appointmentId: ctx.params.id, hasNote: note !== null });
    return { note };
  },
});

export const PUT = defineRoute({
  permission: "surgery.note",
  audit: "SURGERY_NOTE_UPDATE",
  params: z.object({ id: z.uuid() }),
  body: z.strictObject({
    content: z.string().trim().max(2000).refine((v) => !containsResidentRegistrationNumber(v), { message: RRN_FIELD_CODE }),
  }),
  handler: async (ctx) => {
    ctx.audit({ appointmentId: ctx.params.id });
    const result = await saveSurgeryNote(ctx.db, ctx.params.id, ctx.body.content, ctx.staff.id);
    ctx.touchPatients([result.patientId]);
    ctx.audit({ cleared: result.cleared });
    return { ok: true };
  },
});
