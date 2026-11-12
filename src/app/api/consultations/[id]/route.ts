import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { getConsultation, updateConsultation } from "@/server/consult/service";
import { consultContent, interestedItems } from "@/server/consult/schema";

/** 상담 한 건(내용 포함) — F-10(T6-1). 상담·원장·관리자만, 조회마다 감사 행. */
export const GET = defineRoute({
  permission: "consult.read",
  audit: "CONSULT_READ",
  params: z.object({ id: z.uuid() }),
  handler: async (ctx) => {
    const consultation = await getConsultation(ctx.db, ctx.params.id);
    ctx.touchPatients([consultation.patientId]);
    return { consultation };
  },
});

/** 상담 고치기 — 내용·관심 항목·결과 분류·상담자. 감사 행에는 바꾼 필드 이름만. */
export const PATCH = defineRoute({
  permission: "consult.write",
  audit: "CONSULT_UPDATE",
  params: z.object({ id: z.uuid() }),
  body: z
    .strictObject({
      content: consultContent.optional(),
      interestedItems: interestedItems.optional(),
      outcome: z.string().trim().min(1).max(20).optional(),
      counselorId: z.uuid().optional(),
    })
    .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "empty" }),
  handler: async (ctx) => {
    const { patientId } = await updateConsultation(ctx.db, ctx.params.id, ctx.body);
    ctx.touchPatients([patientId]);
    ctx.audit({ consultationId: ctx.params.id, fields: Object.keys(ctx.body).join(","), ...(ctx.body.outcome ? { outcome: ctx.body.outcome } : {}) });
    return { ok: true };
  },
});
