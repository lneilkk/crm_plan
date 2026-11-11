/**
 * 내원 통계 산식 (기획서 4-1 '통계 반영', 4-4) — 실내원율·노쇼율·당일취소율·지각률, 일·주·월 집계.
 *
 * 기획서는 "실내원율(내원 ÷ 예약)"이라고만 적고 분모를 정하지 않았다.
 * 아래가 이 시스템의 정의이며, 통계 화면에도 같은 설명을 보여 준다.
 *
 * ■ 예약 1건의 분류 (기준 시각 asOf, 지각 허용시간 lateToleranceMin)
 *   내원       상태가 내원·진료중·수납완료·귀가 (ARRIVED_STATUSES)
 *   지각내원   내원 중에서 내원 입력 시각이 예약 시각 + 허용시간을 넘은 건 (내원의 부분집합).
 *              정확히 허용시간에 도착했거나 내원 입력 시각이 없으면 지각이 아니다.
 *   노쇼       NO_SHOW
 *   당일취소   CANCELED_SAME_DAY
 *   사전취소   CANCELED_ADVANCE — 분모에서 뺀다. 당일이 되기 전에 일정에서 빠진 예약이다.
 *   예약변경   RESCHEDULED — 분모에서 뺀다. 연결된 새 예약이 옮겨 간 날짜에서 따로 집계된다.
 *   미확인     예약확정·확인완료인데 예약 시각이 기준 시각 이전(같은 시각 포함) — 시간이 지났는데
 *              결과를 아무도 입력하지 않은 건. 분모에 남는다 (입력 누락이 실내원율을 올리지 못하게).
 *   대기       예약확정·확인완료이고 예약 시각이 기준 시각 이후 — 아직 올 시간이 아니다. 분모에서 뺀다.
 *
 * ■ 유효 예약(분모) = 내원 + 노쇼 + 당일취소 + 미확인
 *
 * ■ 비율 (0~1의 값. 분모가 0이면 null — 화면에는 "-")
 *   실내원율   = 내원 ÷ 유효 예약
 *   노쇼율     = 노쇼 ÷ 유효 예약
 *   당일취소율 = 당일취소 ÷ 유효 예약
 *   지각률     = 지각내원 ÷ 내원
 *
 * ■ 일·주·월 집계는 예약 시각의 한국 시간 날짜로 나눈다. 주는 월요일에 시작한다.
 *
 * 입력에는 사람을 식별하는 값이 없다 (예약 시각·상태·내원 입력 시각뿐).
 */

import { isArrivedStatus, isPendingStatus, type AppointmentStatus } from "@/lib/domain/appointment";
import { kstDateKey, kstMonthKey, kstWeekStart } from "@/lib/time/kst";
import { isLateArrival } from "@/lib/visit/lateness";

/** 집계 입력 1건 — 예약 시각, 상태, 내원 입력 시각 */
export interface VisitRow {
  startAt: Date;
  status: AppointmentStatus;
  arrivedAt: Date | null;
}

export interface VisitStatsOptions {
  /** 기준 시각. 이 시각까지 결과가 입력되지 않은 예약은 '미확인'으로 센다 */
  asOf: Date;
  /** 지각 허용시간(분) — 병원 설정 */
  lateToleranceMin: number;
}

export interface VisitStats {
  /** 내원 (지각내원 포함) */
  arrived: number;
  /** 지각내원 — 내원의 부분집합 */
  late: number;
  /** 노쇼 */
  noShow: number;
  /** 당일취소 */
  sameDayCancel: number;
  /** 사전취소 (분모 제외) */
  advanceCancel: number;
  /** 예약변경 (분모 제외) */
  rescheduled: number;
  /** 미확인 — 예약 시각이 지났는데 결과 미입력 */
  unconfirmed: number;
  /** 대기 — 아직 예약 시각 전 (분모 제외) */
  upcoming: number;
  /** 유효 예약 = 내원 + 노쇼 + 당일취소 + 미확인 */
  booked: number;
  /** 실내원율 = 내원 ÷ 유효 예약 */
  arrivalRate: number | null;
  /** 노쇼율 = 노쇼 ÷ 유효 예약 */
  noShowRate: number | null;
  /** 당일취소율 = 당일취소 ÷ 유효 예약 */
  sameDayCancelRate: number | null;
  /** 지각률 = 지각내원 ÷ 내원 */
  lateRate: number | null;
}

export type StatsUnit = "day" | "week" | "month";

export interface VisitBucket {
  /** 일: "YYYY-MM-DD", 주: 그 주 월요일 "YYYY-MM-DD", 월: "YYYY-MM" (모두 한국 시간) */
  key: string;
  stats: VisitStats;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/** 예약 목록 전체를 하나로 집계한다 */
export function summarizeVisits(rows: readonly VisitRow[], options: VisitStatsOptions): VisitStats {
  const asOfMs = options.asOf.getTime();
  let arrived = 0;
  let late = 0;
  let noShow = 0;
  let sameDayCancel = 0;
  let advanceCancel = 0;
  let rescheduled = 0;
  let unconfirmed = 0;
  let upcoming = 0;

  for (const row of rows) {
    if (isArrivedStatus(row.status)) {
      arrived += 1;
      if (row.arrivedAt !== null && isLateArrival(row.startAt, row.arrivedAt, options.lateToleranceMin)) late += 1;
    } else if (isPendingStatus(row.status)) {
      if (row.startAt.getTime() <= asOfMs) unconfirmed += 1;
      else upcoming += 1;
    } else if (row.status === "NO_SHOW") {
      noShow += 1;
    } else if (row.status === "CANCELED_SAME_DAY") {
      sameDayCancel += 1;
    } else if (row.status === "CANCELED_ADVANCE") {
      advanceCancel += 1;
    } else if (row.status === "RESCHEDULED") {
      rescheduled += 1;
    }
  }

  const booked = arrived + noShow + sameDayCancel + unconfirmed;
  return {
    arrived,
    late,
    noShow,
    sameDayCancel,
    advanceCancel,
    rescheduled,
    unconfirmed,
    upcoming,
    booked,
    arrivalRate: ratio(arrived, booked),
    noShowRate: ratio(noShow, booked),
    sameDayCancelRate: ratio(sameDayCancel, booked),
    lateRate: ratio(late, arrived),
  };
}

function bucketKey(startAt: Date, unit: StatsUnit): string {
  const day = kstDateKey(startAt);
  if (unit === "week") return kstWeekStart(day);
  if (unit === "month") return kstMonthKey(day);
  return day;
}

/**
 * 예약 시각의 한국 시간 날짜 기준으로 일·주·월 단위로 나눠 집계한다.
 * 예약이 1건이라도 있는 구간만, 키 오름차순으로 돌려준다.
 */
export function bucketVisits(
  rows: readonly VisitRow[],
  options: VisitStatsOptions & { unit: StatsUnit },
): VisitBucket[] {
  const groups = new Map<string, VisitRow[]>();
  for (const row of rows) {
    const key = bucketKey(row.startAt, options.unit);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  // 키는 자릿수가 고정된 "YYYY-MM(-DD)"라서 문자열 정렬이 곧 날짜순이다.
  return [...groups.keys()].sort().map((key) => ({ key, stats: summarizeVisits(groups.get(key) ?? [], options) }));
}

/** 비율을 "83.3%"(소수 첫째 자리)로, 값이 없으면 "-"로 표시한다 */
export function formatRate(rate: number | null): string {
  return rate === null ? "-" : `${(rate * 100).toFixed(1)}%`;
}
