import { z } from "zod";
import { diffDays, isValidDateKey } from "@/lib/time/kst";
import { defineRoute } from "@/server/api/define-route";
import { ApiError } from "@/server/api/errors";
import { buildVisitReport, MAX_STATS_DAYS } from "@/server/stats/visit-report";

const dateKey = z.string().refine(isValidDateKey);

/**
 * 내원 통계 — T7-2 (원장·관리자).
 * GET /api/stats?from=YYYY-MM-DD&to=YYYY-MM-DD&unit=day|week|month
 *
 * 예약 시각·상태·내원 입력 시각·채널만 집계한다. 응답에 환자 id·이름·전화번호가 없으므로 touchPatients는 부르지 않고,
 * 감사 행에는 기간 일수와 집계한 예약 수만 남긴다.
 */
export const GET = defineRoute({
  permission: "stats.read",
  audit: "STATS_READ",
  query: z.object({ from: dateKey, to: dateKey, unit: z.enum(["day", "week", "month"]).default("day") }),
  handler: async (ctx) => {
    const { from, to, unit } = ctx.query;
    const days = diffDays(from, to) + 1;
    if (days < 1) throw new ApiError(400, "INVALID_RANGE", "시작일이 종료일보다 늦습니다.");
    if (days > MAX_STATS_DAYS) {
      throw new ApiError(400, "RANGE_TOO_LONG", `기간은 최대 ${MAX_STATS_DAYS}일까지 볼 수 있습니다.`);
    }
    const { report, rows } = await buildVisitReport({ from, to, unit, asOf: ctx.now });
    ctx.audit({ days, rows });
    return report;
  },
});
