import { z } from "zod";
import { isValidDateKey } from "@/lib/time/kst";
import { defineRoute } from "@/server/api/define-route";
import { consultContent, interestedItems } from "@/server/consult/schema";
import { createConsultation, getConsultOutcomes, listConsultations } from "@/server/consult/service";

/** 상담 보드 — F-10(T6-1). 그날(한국 시간)의 상담 목록. 내용은 넣지 않는다(상세에서만). 상담·원장·관리자. */
export const GET = defineRoute({
  permission: "consult.read",
  audit: "CONSULT_LIST",
  query: z.object({ date: z.string().refine(isValidDateKey) }),
  handler: async (ctx) => {
    const [items, outcomes] = await Promise.all([listConsultations(ctx.db, ctx.query.date), getConsultOutcomes(ctx.db)]);
    ctx.touchPatients([...new Set(items.map((i) => i.patientId))]);
    ctx.audit({ consultationCount: items.length });
    return { items, outcomes };
  },
});

/** 상담 등록 — F-10(T6-1). 민감정보 동의가 없으면 consentObtained가 필요하다. 감사 행에 내용은 남기지 않는다. */
export const POST = defineRoute({
  permission: "consult.write",
  audit: "CONSULT_CREATE",
  body: z.strictObject({
    patientId: z.uuid(),
    counselorId: z.uuid(),
    consultedAt: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
    content: consultContent,
    interestedItems,
    outcome: z.string().trim().min(1).max(20).nullish(),
    consentObtained: z.boolean().optional(),
  }),
  handler: async (ctx) => {
    ctx.touchPatients([ctx.body.patientId]);
    const created = await createConsultation(ctx.db, ctx.body, ctx.staff.id, ctx.now);
    ctx.audit({ consultationId: created.id, consentRecorded: ctx.body.consentObtained === true });
    return Response.json({ id: created.id }, { status: 201 });
  },
});
