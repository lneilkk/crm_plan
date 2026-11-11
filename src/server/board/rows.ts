/**
 * 내원 보드의 행과 상단 요약 계산 — T5-3 (기획서 4-2, 4-3). DB를 읽지 않는 순수 함수다.
 *
 * - 목록: 그날(한국 시간) 시작하는 예약을 시각순으로. 예약변경(RESCHEDULED)된 원 예약은 빼고,
 *   옮겨 간 새 예약만 그 날짜에 보인다(같은 날 안에서 시간만 바꾼 경우에도 같은 고객이 두 줄로 보이지 않게).
 *   사전취소는 흐리게 남겨 둔다(되돌리기가 가능하고, 오늘 오기로 했던 고객을 찾을 때 필요하다).
 * - 버튼은 availableActions(서버 시각)로 정하고, [취소]가 갈 상태는 resolveCancelStatus로 정해 같이 보낸다.
 * - 지각내원은 저장하지 않고 내원 입력 시각과 예약 시각, 지각 허용시간으로 계산한다.
 * - 응답에는 마스킹한 이름만 담는다. 전화번호·전체 이름은 담지 않는다.
 *
 * 요약 (상단 줄 "오늘 예약 N건 · 내원 N · 대기 N · 노쇼 N · 미확인 N"):
 *   예약(total)  목록에서 사전취소를 뺀 건수 = 내원 + 대기 + 미확인 + 노쇼 + 당일취소
 *   내원         내원·진료중·수납완료·귀가 (지각 포함)
 *   대기         예약확정·확인완료이고 예약 시각 전
 *   미확인       예약확정·확인완료인데 예약 시각이 지남(같은 시각 포함 — 통계 visit-stats.ts와 같은 기준)
 *   노쇼, 당일취소, 지각(내원의 부분집합)
 */

import {
  APPOINTMENT_STATUS_LABEL,
  LATE_ARRIVAL_LABEL,
  isArrivedStatus,
  isPendingStatus,
  type AppointmentChannel,
  type AppointmentStatus,
} from "@/lib/domain/appointment";
import type { ReferralSource } from "@/lib/domain/patient";
import { formatKstTime } from "@/lib/time/kst";
import { isLateArrival, noShowAllowedFrom } from "@/lib/visit/lateness";
import { availableActions, resolveCancelStatus, type BoardAction } from "@/lib/visit/transitions";

/** 미확인 강조: 예약 시각이 지났으면 주황, 노쇼 유예시간까지 지났으면 빨강 (T5-4가 색과 알림을 다듬는다) */
export type Overdue = "none" | "orange" | "red";

/** 계산에 필요한 예약 한 건 (DB에서 읽은 값) */
export type BoardSource = {
  id: string;
  patientId: string;
  nameMasked: string;
  startAt: Date;
  durationMin: number;
  chair: string;
  status: AppointmentStatus;
  arrivedAt: Date | null;
  treatmentItem: string;
  channel: AppointmentChannel;
  doctorName: string | null;
  counselorName: string | null;
  referralSource: ReferralSource | null;
  /** 등록 구분이 신규이고 이 예약보다 앞서 내원한 예약이 없음 */
  isNew: boolean;
};

/** GET /api/board 응답의 행 (JSON 그대로의 모양: 시각은 ISO 문자열) */
export type BoardRow = {
  id: string;
  patientId: string;
  /** 한국 시간 "HH:mm" */
  time: string;
  startAt: string;
  durationMin: number;
  chair: string;
  nameMasked: string;
  isNew: boolean;
  treatmentItem: string;
  doctorName: string | null;
  counselorName: string | null;
  referralSource: ReferralSource | null;
  channel: AppointmentChannel;
  status: AppointmentStatus;
  /** 지각내원이면 "지각내원", 아니면 상태 이름 */
  statusLabel: string;
  isLate: boolean;
  arrivedAt: string | null;
  actions: BoardAction[];
  noShowAllowedAt: string | null;
  /** [취소]를 누르면 갈 상태 (예약일 전이면 사전취소, 당일부터 당일취소) */
  cancelTo: "CANCELED_SAME_DAY" | "CANCELED_ADVANCE";
  overdue: Overdue;
};

export type BoardSummary = {
  total: number;
  arrived: number;
  waiting: number;
  noShow: number;
  unconfirmed: number;
  sameDayCanceled: number;
  late: number;
};

export type BoardSettings = { lateToleranceMin: number; noShowGraceMin: number };

export function overdueOf(status: AppointmentStatus, startAt: Date, now: Date, noShowGraceMin: number): Overdue {
  if (!isPendingStatus(status) || now.getTime() < startAt.getTime()) return "none";
  return now.getTime() >= noShowAllowedFrom(startAt, noShowGraceMin).getTime() ? "red" : "orange";
}

export function toBoardRow(source: BoardSource, settings: BoardSettings, now: Date): BoardRow {
  const { startAt, status, arrivedAt } = source;
  const isLate =
    isArrivedStatus(status) && arrivedAt !== null && isLateArrival(startAt, arrivedAt, settings.lateToleranceMin);
  const { actions, noShowAllowedAt } = availableActions({
    status,
    startAt,
    now,
    noShowGraceMin: settings.noShowGraceMin,
  });
  return {
    id: source.id,
    patientId: source.patientId,
    time: formatKstTime(startAt),
    startAt: startAt.toISOString(),
    durationMin: source.durationMin,
    chair: source.chair,
    nameMasked: source.nameMasked,
    isNew: source.isNew,
    treatmentItem: source.treatmentItem,
    doctorName: source.doctorName,
    counselorName: source.counselorName,
    referralSource: source.referralSource,
    channel: source.channel,
    status,
    statusLabel: isLate && status === "ARRIVED" ? LATE_ARRIVAL_LABEL : APPOINTMENT_STATUS_LABEL[status],
    isLate,
    arrivedAt: arrivedAt?.toISOString() ?? null,
    actions,
    noShowAllowedAt: noShowAllowedAt?.toISOString() ?? null,
    cancelTo: resolveCancelStatus(startAt, now),
    overdue: overdueOf(status, startAt, now, settings.noShowGraceMin),
  };
}

/** 보드에 보이는 예약인지 — 예약변경된 원 예약은 옮겨 간 새 예약이 대신 보인다 */
export function isOnBoard(status: AppointmentStatus): boolean {
  return status !== "RESCHEDULED";
}

export function summarize(rows: readonly BoardRow[], now: Date): BoardSummary {
  const summary: BoardSummary = { total: 0, arrived: 0, waiting: 0, noShow: 0, unconfirmed: 0, sameDayCanceled: 0, late: 0 };
  for (const row of rows) {
    if (row.status === "CANCELED_ADVANCE" || row.status === "RESCHEDULED") continue;
    summary.total += 1;
    if (isArrivedStatus(row.status)) {
      summary.arrived += 1;
      if (row.isLate) summary.late += 1;
    } else if (isPendingStatus(row.status)) {
      if (now.getTime() < new Date(row.startAt).getTime()) summary.waiting += 1;
      else summary.unconfirmed += 1;
    } else if (row.status === "NO_SHOW") {
      summary.noShow += 1;
    } else if (row.status === "CANCELED_SAME_DAY") {
      summary.sameDayCanceled += 1;
    }
  }
  return summary;
}

/** 시각순(같은 시각은 체어, id 순)으로 정렬한 행과 요약 */
export function buildBoard(sources: readonly BoardSource[], settings: BoardSettings, now: Date) {
  const items = sources
    .filter((source) => isOnBoard(source.status))
    .toSorted(
      (a, b) =>
        a.startAt.getTime() - b.startAt.getTime() || a.chair.localeCompare(b.chair) || a.id.localeCompare(b.id),
    )
    .map((source) => toBoardRow(source, settings, now));
  return { items, summary: summarize(items, now) };
}
