import { z } from "zod";
import { diffDays, isValidDateKey } from "@/lib/time/kst";
import { defineRoute } from "@/server/api/define-route";
import { ApiError } from "@/server/api/errors";
import { canSeePrice } from "@/server/appointments/price";
import { buildPerformanceReport, withoutAmounts } from "@/server/stats/performance";
import { MAX_STATS_DAYS } from "@/server/stats/visit-report";

const dateKey = z.string().refine(isValidDateKey);

/**
 * 의사·상담자 실적 — F-6 (원장·관리자). GET /api/stats/performance?from=YYYY-MM-DD&to=YYYY-MM-DD
 * 응답은 담당자·항목별 개수와 금액뿐이라 환자를 알리지 않는다. 감사 행에는 기간 일수와 집계한 예약 수.
 */
export const GET = defineRoute({
  permission: "stats.read",
  audit: "STATS_PERFORMANCE_READ",
  query: z.object({ from: dateKey, to: dateKey }),
  handler: async (ctx) => {
    const { from, to } = ctx.query;
    const days = diffDays(from, to) + 1;
    if (days < 1) throw new ApiError(400, "INVALID_RANGE", "시작일이 종료일보다 늦습니다.");
    if (days > MAX_STATS_DAYS) throw new ApiError(400, "RANGE_TOO_LONG", `기간은 최대 ${MAX_STATS_DAYS}일까지 볼 수 있습니다.`);
    const { report, rows } = await buildPerformanceReport(from, to);
    ctx.audit({ days, rows });
    // 금액은 금액 권한이 있는 사람에게만 (S-3)
    return canSeePrice(ctx.staff) ? report : withoutAmounts(report);
  },
});
