/**
 * 통계 화면의 기간 선택 — 미리 정한 기간(이번 주 등)을 한국 시간 날짜 범위로 바꾼다.
 * 서버 한도(src/server/stats/visit-report.ts의 MAX_STATS_DAYS)와 같은 366일을 화면에서도 먼저 검사한다.
 */
import type { StatsUnit } from "@/lib/stats/visit-stats";
import { addDays, diffDays, isValidDateKey, kstMonthKey, kstWeekStart, type DateKey } from "@/lib/time/kst";

export const PERIOD_PRESETS = [
  { key: "thisWeek", label: "이번 주" },
  { key: "lastWeek", label: "지난 주" },
  { key: "thisMonth", label: "이번 달" },
  { key: "lastMonth", label: "지난 달" },
  { key: "last3Months", label: "최근 3개월" },
  { key: "custom", label: "직접 선택" },
] as const;

export type PeriodPreset = (typeof PERIOD_PRESETS)[number]["key"];

export const STATS_UNITS: { key: StatsUnit; label: string }[] = [
  { key: "day", label: "일" },
  { key: "week", label: "주" },
  { key: "month", label: "월" },
];

export const MAX_PERIOD_DAYS = 366;

/** '최근 3개월'의 일수 (오늘 포함) */
export const RECENT_DAYS = 90;

export type Period = { from: DateKey; to: DateKey };

/**
 * 미리 정한 기간의 날짜 범위. '이번 ~'과 '최근 3개월'은 오늘까지다(앞으로 올 예약은 통계에서 '대기'라 빠진다).
 * 'custom'은 범위가 정해져 있지 않아 null.
 */
export function presetPeriod(preset: PeriodPreset, today: DateKey): Period | null {
  const monthStart = `${kstMonthKey(today)}-01`;
  switch (preset) {
    case "thisWeek":
      return { from: kstWeekStart(today), to: today };
    case "lastWeek": {
      const thisMonday = kstWeekStart(today);
      return { from: addDays(thisMonday, -7), to: addDays(thisMonday, -1) };
    }
    case "thisMonth":
      return { from: monthStart, to: today };
    case "lastMonth": {
      const lastDay = addDays(monthStart, -1);
      return { from: `${kstMonthKey(lastDay)}-01`, to: lastDay };
    }
    case "last3Months":
      return { from: addDays(today, -(RECENT_DAYS - 1)), to: today };
    case "custom":
      return null;
  }
}

/** 직접 고른 기간의 오류 문구. 문제가 없으면 null */
export function periodError(period: Period): string | null {
  if (!isValidDateKey(period.from) || !isValidDateKey(period.to)) return "시작일과 종료일을 모두 고르세요.";
  const days = diffDays(period.from, period.to) + 1;
  if (days < 1) return "시작일이 종료일보다 늦습니다.";
  if (days > MAX_PERIOD_DAYS) return `기간은 최대 ${MAX_PERIOD_DAYS}일까지 볼 수 있습니다.`;
  return null;
}

/** 구간 키를 화면 표시로: 일 "11/3 (월)", 주 "11/3 주", 월 "2026년 11월" */
export function bucketLabel(key: string, unit: StatsUnit): string {
  if (unit === "month") {
    const [y, m] = key.split("-");
    return `${y}년 ${Number(m)}월`;
  }
  const [, m, d] = key.split("-");
  const short = `${Number(m)}/${Number(d)}`;
  return unit === "week" ? `${short} 주` : short;
}
