/**
 * 예약 도메인 상수 — 기획서 4-1(예약 상태값 정의), 4-3(입력 규칙) 기준.
 *
 * 서버·브라우저 공용이라 Prisma 생성 코드를 import하지 않는다.
 * DB enum(prisma/schema.prisma)과 값이 같아야 하며, 이는 서버 쪽 타입 검사로 강제한다.
 */

/**
 * 예약 상태값 (기획서 4-1).
 *
 * '지각내원'은 저장하지 않는다. 기획서 6장: "지각 판정은 저장하지 않고 '예약 시각'과
 * '내원 입력 시각'의 차이로 계산한다." → 저장 상태는 ARRIVED이고, 화면·통계에서
 * 내원 입력 시각이 예약 시각 + 허용시간을 넘으면 '지각내원'으로 표시한다.
 */
export const APPOINTMENT_STATUSES = [
  "BOOKED", // 예약확정 — 예약 등록 완료
  "CONFIRMED", // 확인완료 — 리마인더·해피콜에 '방문 예정' 응답
  "ARRIVED", // 내원 — 실제 도착 (지각 여부는 계산)
  "NO_SHOW", // 노쇼 — 연락 없이 오지 않음
  "CANCELED_SAME_DAY", // 당일취소 — 당일 고객이 취소 연락
  "CANCELED_ADVANCE", // 사전취소 — 전날 이전 취소
  "RESCHEDULED", // 예약변경 — 다른 일시로 이동 (새 예약이 원 예약 id를 가짐)
  "IN_TREATMENT", // 진료중 — 내원 이후 원내 단계 (2차 기능에서 사용)
  "PAID", // 수납완료
  "LEFT", // 귀가
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  BOOKED: "예약확정",
  CONFIRMED: "확인완료",
  ARRIVED: "내원",
  NO_SHOW: "노쇼",
  CANCELED_SAME_DAY: "당일취소",
  CANCELED_ADVANCE: "사전취소",
  RESCHEDULED: "예약변경",
  IN_TREATMENT: "진료중",
  PAID: "수납완료",
  LEFT: "귀가",
};

/** 화면·통계에서만 쓰는 계산된 상태 표시 */
export const LATE_ARRIVAL_LABEL = "지각내원";

/** 아직 결과가 정해지지 않은 상태 (내원 보드에서 버튼을 누르기 전) */
export const PENDING_STATUSES = ["BOOKED", "CONFIRMED"] as const satisfies readonly AppointmentStatus[];

/** 실제로 내원한 상태 — 내원 이후 원내 단계 포함. 실내원율의 분자 */
export const ARRIVED_STATUSES = ["ARRIVED", "IN_TREATMENT", "PAID", "LEFT"] as const satisfies readonly AppointmentStatus[];

/** 체어 시간을 차지하는 상태 — 같은 체어·시간 중복 예약 검사 대상 (DB 제약과 같아야 함) */
export const SLOT_HOLDING_STATUSES = [
  ...PENDING_STATUSES,
  ...ARRIVED_STATUSES,
] as const satisfies readonly AppointmentStatus[];

export function isPendingStatus(status: AppointmentStatus): boolean {
  return (PENDING_STATUSES as readonly AppointmentStatus[]).includes(status);
}

export function isArrivedStatus(status: AppointmentStatus): boolean {
  return (ARRIVED_STATUSES as readonly AppointmentStatus[]).includes(status);
}

/** 노쇼·당일취소 사유 코드 (기획서 4-3 규칙 3) */
export const VISIT_REASON_CODES = ["NO_CONTACT", "PERSONAL", "OTHER_CLINIC", "OTHER"] as const;

export type VisitReasonCode = (typeof VISIT_REASON_CODES)[number];

export const VISIT_REASON_LABEL: Record<VisitReasonCode, string> = {
  NO_CONTACT: "연락두절",
  PERSONAL: "개인사정",
  OTHER_CLINIC: "타병원",
  OTHER: "기타",
};

/** 사유 선택이 필수인 상태 */
export const REASON_REQUIRED_STATUSES = ["NO_SHOW", "CANCELED_SAME_DAY"] as const satisfies readonly AppointmentStatus[];

/** 예약 채널 — 이 예약이 어떤 경로로 들어왔는지 */
export const APPOINTMENT_CHANNELS = ["PHONE", "WEBSITE", "PLATFORM", "ONSITE", "WALK_IN"] as const;

export type AppointmentChannel = (typeof APPOINTMENT_CHANNELS)[number];

export const APPOINTMENT_CHANNEL_LABEL: Record<AppointmentChannel, string> = {
  PHONE: "전화",
  WEBSITE: "홈페이지",
  PLATFORM: "플랫폼 앱",
  ONSITE: "현장",
  WALK_IN: "워크인",
};
