import { z } from "zod";
import { isValidTime } from "@/lib/time/kst";
import { defineRoute } from "@/server/api/define-route";
import { saveClinicRules } from "@/server/settings/clinic-settings";

/** 진료시간·지각 허용·노쇼 유예 시간 저장 — F-14(T4-4), 관리자. */
const time = z.string().refine(isValidTime, { message: "time" });
const day = z.strictObject({ open: time, close: time }).nullable();

export const PUT = defineRoute({
  permission: "settings.write",
  audit: "SETTINGS_RULES_UPDATE",
  body: z.strictObject({
    lateToleranceMin: z.number().int().min(0).max(120),
    noShowGraceMin: z.number().int().min(0).max(240),
    businessHours: z.strictObject({ "0": day, "1": day, "2": day, "3": day, "4": day, "5": day, "6": day }),
  }),
  handler: async (ctx) => {
    await saveClinicRules(ctx.db, ctx.body, ctx.staff.id);
    ctx.audit({ lateToleranceMin: ctx.body.lateToleranceMin, noShowGraceMin: ctx.body.noShowGraceMin });
    return { ok: true };
  },
});
