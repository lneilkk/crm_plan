import { z } from "zod";
import { isHexColor } from "@/lib/calendar/colors";
import { CONSULT_OUTCOME_KINDS, CONSULT_OUTCOME_NAME_MAX, MAX_CONSULT_OUTCOMES } from "@/lib/domain/consult";
import { defineRoute } from "@/server/api/define-route";
import { ApiError } from "@/server/api/errors";
import { getConsultOutcomes } from "@/server/consult/service";

/** 상담 결과 분류 — F-10. 읽기는 모든 직원, 저장은 관리자([편집]). 이미 저장된 상담의 분류 이름은 그대로 남는다. */
export const GET = defineRoute({
  permission: "settings.read",
  audit: "none",
  handler: async (ctx) => ({ outcomes: await getConsultOutcomes(ctx.db) }),
});

export const PUT = defineRoute({
  permission: "settings.write",
  audit: "CONSULT_OUTCOMES_UPDATE",
  body: z.strictObject({
    outcomes: z
      .array(z.strictObject({ name: z.string().trim().min(1).max(CONSULT_OUTCOME_NAME_MAX), color: z.string().refine(isHexColor), kind: z.enum(CONSULT_OUTCOME_KINDS) }))
      .min(1)
      .max(MAX_CONSULT_OUTCOMES),
  }),
  handler: async (ctx) => {
    const names = ctx.body.outcomes.map((o) => o.name);
    if (new Set(names).size !== names.length) throw new ApiError(400, "DUPLICATE_OUTCOME", "같은 이름의 분류가 있습니다.");
    if (!ctx.body.outcomes.some((o) => o.kind === "SURGERY")) throw new ApiError(400, "NO_SURGERY_OUTCOME", "'수술예약' 종류의 분류가 하나 이상 있어야 합니다.");
    await ctx.db.clinicSetting.update({
      where: { id: 1 },
      data: { consultOutcomes: ctx.body.outcomes.map((o) => ({ ...o, color: o.color.toUpperCase() })), updatedById: ctx.staff.id },
    });
    ctx.audit({ outcomeCount: names.length });
    return { outcomes: await getConsultOutcomes(ctx.db) };
  },
});
