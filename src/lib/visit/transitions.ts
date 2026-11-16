/**
 * 예약 상태 전환 규칙 (기획서 4-1 상태값, 4-2 보드 버튼, 4-3 입력 규칙).
 *
 * 순수 함수만 둔다. 서버(상태 변경 API)와 브라우저(내원 보드 버튼)가 같은 규칙을 쓴다.
 * 권한(당일은 프론트, 익일부터 관리자)과 이력 기록은 여기서 다루지 않는다 — 상태 변경 API의 몫이다.
 *
 * - 되돌리기도 하나의 전환이다. 이력(visit_status_log)은 추가만 가능하므로 되돌린 것도 한 줄로 남는다.
 * - 결과를 다른 결과로 고칠 때(예: 노쇼 → 당일취소)는 대기 상태(예약확정·확인완료)로 되돌린 뒤 다시 입력한다.
 * - '지각내원'은 저장 상태가 아니다. 내원(ARRIVED) + 계산된 지각 여부다 (lateness.ts).
 */

import {
  APPOINTMENT_STATUS_LABEL,
  REASON_REQUIRED_STATUSES,
  VISIT_REASON_CODES,
  isArrivedStatus,
  isPendingStatus,
  type AppointmentStatus,
  type VisitReasonCode,
} from "@/lib/domain/appointment";
import { formatKstTime, kstDateKey, kstDayStart } from "@/lib/time/kst";
import { noShowAllowedFrom } from "./lateness";

/** 허용되는 전환 표: from → 갈 수 있는 상태. 여기에 없는 전환은 같은 상태로의 전환을 포함해 모두 거부한다. */
export const STATUS_TRANSITIONS: Readonly<Record<AppointmentStatus, readonly AppointmentStatus[]>> = {
  BOOKED: ["CONFIRMED", "ARRIVED", "NO_SHOW", "CANCELED_SAME_DAY", "CANCELED_ADVANCE", "RESCHEDULED"],
  CONFIRMED: ["BOOKED", "ARRIVED", "NO_SHOW", "CANCELED_SAME_DAY", "CANCELED_ADVANCE", "RESCHEDULED"],
  // 되돌리기(노쇼 행에서 잘못 누른 [내원] 포함), 또는 원내 다음 단계로
  ARRIVED: ["BOOKED", "CONFIRMED", "NO_SHOW", "IN_TREATMENT"],
  // 되돌리기, 또는 노쇼 처리 뒤 늦게 도착한 경우
  NO_SHOW: ["BOOKED", "CONFIRMED", "ARRIVED"],
  // 되돌리기만
  CANCELED_SAME_DAY: ["BOOKED", "CONFIRMED"],
  CANCELED_ADVANCE: ["BOOKED", "CONFIRMED"],
  // 나갈 수 없다. 원 예약과 연결된 새 예약이 이어받는다
  RESCHEDULED: [],
  // 되돌리기, 또는 원내 다음 단계로
  IN_TREATMENT: ["ARRIVED", "PAID"],
  PAID: ["IN_TREATMENT", "LEFT"],
  LEFT: ["PAID"],
};

/** 전환 표만 본다. 시각·사유 조건까지 보려면 validateTransition을 쓴다. */
export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

export type TransitionErrorCode =
  | "NOT_ALLOWED" // 전환 표에 없는 전환
  | "NO_SHOW_TOO_EARLY" // 노쇼 유예시간이 아직 지나지 않음
  | "REASON_REQUIRED" // 노쇼·당일취소에 사유가 없음
  | "CANCEL_IS_SAME_DAY" // 사전취소를 요청했지만 예약 당일 이후라 당일취소여야 함
  | "CANCEL_IS_ADVANCE" // 당일취소를 요청했지만 예약일 전이라 사전취소여야 함
  | "ARRIVAL_BEFORE_APPOINTMENT_DAY"; // 예약일 전에 내원 처리

export type TransitionResult = { ok: true } | { ok: false; code: TransitionErrorCode; message: string };

export interface TransitionInput {
  from: AppointmentStatus;
  to: AppointmentStatus;
  /** 예약 시각 */
  startAt: Date;
  /** 입력하는 지금 시각 (서버 시각) */
  now: Date;
  /** 노쇼 유예시간(분) — 병원 설정 */
  noShowGraceMin: number;
  /** 노쇼·당일취소에만 필요하다. 다른 상태에 보내면 무시한다 */
  reasonCode?: VisitReasonCode | null;
}

function reject(code: TransitionErrorCode, message: string): TransitionResult {
  return { ok: false, code, message };
}

/**
 * 잘못된 값은 규칙을 통과시키지 않고 던진다.
 * NaN과의 비교는 항상 false라서, 검사하지 않으면 "아직 이르다"는 판정이 빠져 전환이 허용된다.
 */
function assertValidDate(value: Date, name: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError(`${name} 값이 올바른 시각이 아닙니다`);
  }
}

function assertValidTimes(startAt: Date, now: Date, noShowGraceMin?: number): void {
  assertValidDate(startAt, "startAt");
  assertValidDate(now, "now");
  if (noShowGraceMin !== undefined && !(Number.isFinite(noShowGraceMin) && noShowGraceMin >= 0)) {
    throw new RangeError("noShowGraceMin 값은 0 이상의 숫자여야 합니다");
  }
}

/** 지금이 예약일(한국 시간)의 00:00보다 앞인지 */
function isBeforeAppointmentDay(startAt: Date, now: Date): boolean {
  return now.getTime() < kstDayStart(kstDateKey(startAt)).getTime();
}

function hasReason(reasonCode: VisitReasonCode | null | undefined): boolean {
  return reasonCode != null && VISIT_REASON_CODES.includes(reasonCode);
}

/**
 * 전환 표 → 시각 조건 → 사유 순서로 검사한다 (기획서 4-3).
 * 메시지는 직원에게 그대로 보여 줄 수 있고 환자 정보를 담지 않는다.
 *
 * startAt·now가 올바른 시각이 아니거나 noShowGraceMin이 0 이상의 숫자가 아니면 RangeError를 던진다.
 */
export function validateTransition(input: TransitionInput): TransitionResult {
  const { from, to, startAt, now, noShowGraceMin, reasonCode } = input;
  // 구조 분해한 값은 타입상 number지만, 설정이 비어 undefined로 들어오는 경우도 막는다
  assertValidTimes(startAt, now, noShowGraceMin ?? Number.NaN);

  if (!canTransition(from, to)) {
    const fromLabel = APPOINTMENT_STATUS_LABEL[from];
    const toLabel = APPOINTMENT_STATUS_LABEL[to];
    return reject(
      "NOT_ALLOWED",
      from === to ? `이미 '${toLabel}' 상태입니다.` : `'${fromLabel}'에서 '${toLabel}' 상태로는 바꿀 수 없습니다.`,
    );
  }

  if (to === "NO_SHOW") {
    const allowedFrom = noShowAllowedFrom(startAt, noShowGraceMin);
    if (now.getTime() < allowedFrom.getTime()) {
      return reject(
        "NO_SHOW_TOO_EARLY",
        `노쇼 처리는 예약 시각에서 유예시간 ${noShowGraceMin}분이 지난 ${formatKstTime(allowedFrom)}부터 할 수 있습니다.`,
      );
    }
  }

  if (to === "CANCELED_SAME_DAY" && isBeforeAppointmentDay(startAt, now)) {
    return reject("CANCEL_IS_ADVANCE", "예약일 전의 취소는 당일취소가 아니라 사전취소로 처리해야 합니다.");
  }

  if (to === "CANCELED_ADVANCE" && !isBeforeAppointmentDay(startAt, now)) {
    return reject("CANCEL_IS_SAME_DAY", "예약 당일부터의 취소는 사전취소가 아니라 당일취소로 처리해야 합니다.");
  }

  if (to === "ARRIVED" && isBeforeAppointmentDay(startAt, now)) {
    return reject(
      "ARRIVAL_BEFORE_APPOINTMENT_DAY",
      "예약일 전에는 내원 처리를 할 수 없습니다. 일정이 바뀌었다면 예약변경으로 처리해 주세요.",
    );
  }

  if ((REASON_REQUIRED_STATUSES as readonly AppointmentStatus[]).includes(to) && !hasReason(reasonCode)) {
    return reject("REASON_REQUIRED", `${APPOINTMENT_STATUS_LABEL[to]} 처리에는 사유를 선택해야 합니다.`);
  }

  return { ok: true };
}

/** [취소] 버튼의 자동 구분: 예약일(한국 시간) 전이면 사전취소, 당일부터는 당일취소 */
export function resolveCancelStatus(startAt: Date, now: Date): "CANCELED_SAME_DAY" | "CANCELED_ADVANCE" {
  assertValidTimes(startAt, now);
  return isBeforeAppointmentDay(startAt, now) ? "CANCELED_ADVANCE" : "CANCELED_SAME_DAY";
}

/** 내원 보드의 버튼 (기획서 4-2): [내원] [노쇼] [취소] [변경] + 되돌리기 */
export const BOARD_ACTIONS = ["ARRIVE", "NO_SHOW", "CANCEL", "RESCHEDULE", "REVERT"] as const;

export type BoardAction = (typeof BOARD_ACTIONS)[number];

export interface AvailableActions {
  /** 지금 누를 수 있는 버튼 (BOARD_ACTIONS 순서) */
  actions: BoardAction[];
  /** 노쇼로 갈 수 있는 상태지만 유예시간이 안 지났을 때, [노쇼]가 가능해지는 시각. 그 외에는 null */
  noShowAllowedAt: Date | null;
}

/**
 * 지금 이 예약에서 누를 수 있는 보드 버튼.
 *
 * 사유는 버튼을 누른 뒤에 고르므로 여기서는 보지 않는다.
 * REVERT는 결과가 이미 입력된 상태에서 바로 앞 상태로 돌아가는 것이다. 어디로 돌아갈지는 이력의 이전 상태가 정하고,
 * 그 전환도 validateTransition을 통과해야 한다.
 * 내원 → 노쇼는 노쇼 행에서 잘못 누른 [내원]을 되돌릴 때만 쓴다. 그래서 내원한 행에는 [노쇼] 버튼을 내지 않는다.
 * 되돌릴 때도 노쇼 사유와 유예시간 조건은 그대로 검사한다 (사유는 직전 노쇼 이력의 사유를 다시 쓰면 된다).
 *
 * 입력값이 올바르지 않으면 validateTransition과 같이 RangeError를 던진다.
 */
export function availableActions(input: {
  status: AppointmentStatus;
  startAt: Date;
  now: Date;
  noShowGraceMin: number;
}): AvailableActions {
  const { status, startAt, now, noShowGraceMin } = input;
  assertValidTimes(startAt, now, noShowGraceMin ?? Number.NaN);
  // 사유는 아직 고르기 전이므로, 사유가 있다고 치고 나머지 조건만 본다
  const allowed = (to: AppointmentStatus) =>
    validateTransition({ from: status, to, startAt, now, noShowGraceMin, reasonCode: "OTHER" }).ok;

  const possible: Record<BoardAction, boolean> = {
    // 이미 내원한 뒤(진료중 → 내원)는 [내원] 버튼이 아니라 되돌리기다
    ARRIVE: !isArrivedStatus(status) && allowed("ARRIVED"),
    NO_SHOW: !isArrivedStatus(status) && allowed("NO_SHOW"),
    CANCEL: allowed(resolveCancelStatus(startAt, now)),
    RESCHEDULE: allowed("RESCHEDULED"),
    // 대기 상태가 아닌 상태의 전환에는 항상 되돌아가는 길이 들어 있다 (예약변경만 전환이 없다)
    REVERT: !isPendingStatus(status) && STATUS_TRANSITIONS[status].length > 0,
  };

  return {
    actions: BOARD_ACTIONS.filter((action) => possible[action]),
    noShowAllowedAt:
      isPendingStatus(status) && !possible.NO_SHOW ? noShowAllowedFrom(startAt, noShowGraceMin) : null,
  };
}
