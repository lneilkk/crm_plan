/**
 * 지각 판정 (기획서 4-1 '지각내원', 6장).
 *
 * 지각 여부는 저장하지 않고 '예약 시각'과 '내원 입력 시각'의 차이로 계산한다.
 * 내원 입력 시각이 예약 시각 + 허용시간을 넘으면 지각이다. 정확히 허용시간에 도착한 것은 지각이 아니다.
 */

const MINUTE_MS = 60_000;

export function isLateArrival(startAt: Date, arrivedAt: Date, lateToleranceMin: number): boolean {
  return arrivedAt.getTime() > startAt.getTime() + lateToleranceMin * MINUTE_MS;
}

/** 노쇼 처리가 가능해지는 시각 = 예약 시각 + 유예시간 (기획서 4-3 규칙 2) */
export function noShowAllowedFrom(startAt: Date, noShowGraceMin: number): Date {
  return new Date(startAt.getTime() + noShowGraceMin * MINUTE_MS);
}
