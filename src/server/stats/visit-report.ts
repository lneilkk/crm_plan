import "server-only";

import { APPOINTMENT_CHANNELS, type AppointmentChannel } from "@/lib/domain/appointment";
import { DEFAULT_LATE_TOLERANCE_MIN } from "@/lib/domain/clinic";
import {
  bucketVisits,
  summarizeVisits,
  type StatsUnit,
  type VisitBucket,
  type VisitStats,
} from "@/lib/stats/visit-stats";
import { addDays, diffDays, kstDayStart, type DateKey } from "@/lib/time/kst";
import { db } from "@/server/db";

/**
 * 내원 통계 보고서 — T7-2 (GET /api/stats).
 *
 * 예약에서 예약 시각·상태·내원 입력 시각·예약 채널만 읽는다.
 * 이름·전화번호·환자 id 같은 사람을 식별하는 값은 조회하지도, 돌려주지도 않는다.
 * 산식은 src/lib/stats/visit-stats.ts 그대로이고, 아래 정의 문구가 그 설명이다.
 */

/** 한 번에 볼 수 있는 최대 기간(일, 시작일·종료일 포함) */
export const MAX_STATS_DAYS = 366;

/** 통계 화면 '설명'에 보여 주는 정의 (visit-stats.ts의 정의와 같아야 한다) */
export const VISIT_STATS_DEFINITIONS: readonly string[] = [
  "유효 예약 = 내원 + 노쇼 + 당일취소 + 미확인. 사전취소·예약변경·아직 시간이 안 된 예약(대기)은 빠집니다.",
  "실내원율 = 내원 ÷ 유효 예약. 내원에는 진료중·수납완료·귀가 단계와 지각내원이 포함됩니다.",
  "노쇼율 = 노쇼 ÷ 유효 예약.",
  "당일취소율 = 당일취소 ÷ 유효 예약.",
  "지각률 = 지각내원 ÷ 내원. 내원 입력 시각이 예약 시각 + 지각 허용시간(병원 설정)을 넘으면 지각내원입니다.",
  "미확인 = 예약 시각이 지났는데 내원·노쇼·취소 결과를 아무도 입력하지 않은 예약. 분모에 남으므로 입력이 빠지면 실내원율이 내려갑니다.",
  "예약변경된 예약은 옮겨 간 새 예약의 날짜에서 집계됩니다.",
  "일·주·월은 예약 시각의 한국 시간 날짜로 나눕니다. 주는 월요일에 시작하며, 기간 양 끝의 주·월은 기간 안의 날짜만 셉니다.",
  "비율은 소수 첫째 자리까지 표시하고, 분모가 0이면 '-'로 표시합니다.",
];

export type VisitReport = {
  range: { from: DateKey; to: DateKey; days: number };
  unit: StatsUnit;
  /** 집계 기준 시각(서버 시각, ISO) — 이 시각 전에 결과 미입력이면 미확인 */
  asOf: string;
  lateToleranceMin: number;
  total: VisitStats;
  buckets: VisitBucket[];
  byChannel: { channel: AppointmentChannel; stats: VisitStats }[];
  definitions: readonly string[];
};

export type VisitReportInput = { from: DateKey; to: DateKey; unit: StatsUnit; asOf: Date };

/** from~to(한국 시간 날짜, 양 끝 포함)의 예약을 집계한다. 기간 검사는 부르는 쪽(라우트)이 한다. */
export async function buildVisitReport(input: VisitReportInput): Promise<{ report: VisitReport; rows: number }> {
  const [appointments, setting] = await Promise.all([
    db.appointment.findMany({
      where: { startAt: { gte: kstDayStart(input.from), lt: kstDayStart(addDays(input.to, 1)) } },
      select: { startAt: true, status: true, arrivedAt: true, channel: true },
    }),
    db.clinicSetting.findUnique({ where: { id: 1 }, select: { lateToleranceMin: true } }),
  ]);

  const options = { asOf: input.asOf, lateToleranceMin: setting?.lateToleranceMin ?? DEFAULT_LATE_TOLERANCE_MIN };
  const byChannel = APPOINTMENT_CHANNELS.map((channel) => ({
    channel,
    stats: summarizeVisits(
      appointments.filter((row) => row.channel === channel),
      options,
    ),
  }));

  return {
    rows: appointments.length,
    report: {
      range: { from: input.from, to: input.to, days: diffDays(input.from, input.to) + 1 },
      unit: input.unit,
      asOf: input.asOf.toISOString(),
      lateToleranceMin: options.lateToleranceMin,
      total: summarizeVisits(appointments, options),
      buckets: bucketVisits(appointments, { ...options, unit: input.unit }),
      byChannel,
      definitions: VISIT_STATS_DEFINITIONS,
    },
  };
}
