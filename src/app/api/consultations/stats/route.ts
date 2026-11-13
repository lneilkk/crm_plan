import { z } from "zod";
import { diffDays, isValidDateKey } from "@/lib/time/kst";
import { defineRoute } from "@/server/api/define-route";
import { ApiError } from "@/server/api/errors";
import { consultationStats } from "@/server/consult/service";

const dateKey = z.string().refine(isValidDateKey);

/** 상담 통계 — F-10(T6-2 상담자별 전환율). 개수만 돌려주고 환자 정보는 없다. */
export const GET = defineRoute({
  permission: "consult.read",
  audit: "CONSULT_STATS",
  query: z.object({ from: dateKey, to: dateKey }),
  handler: async (ctx) => {
    const days = diffDays(ctx.query.from, ctx.query.to) + 1;
    if (days < 1 || days > 366) throw new ApiError(400, "INVALID_RANGE", "기간을 확인하세요(최대 366일).");
    const { rows, ...stats } = await consultationStats(ctx.db, ctx.query.from, ctx.query.to);
    ctx.audit({ days, rows });
    return stats;
  },
});
