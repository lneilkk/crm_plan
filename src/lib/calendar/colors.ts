import { APPOINTMENT_STATUS_LABEL, APPOINTMENT_STATUSES, type AppointmentStatus } from "@/lib/domain/appointment";

/**
 * 예약 캘린더 색 — F-2. 화면(칸 색·범례·편집 탭)과 서버(입력 검사)가 같이 쓴다.
 *
 * - 라벨: 관리자가 만드는 이름표(금액·고객 분류). 예약에 여러 개 붙고, 칸 색은 붙은 라벨 중
 *   편집 탭 순서상 가장 위(sortOrder 최소) 라벨의 색이다. 라벨이 없으면 예약 상태의 색.
 * - 상태: 목록은 기획서 4-1 그대로(통계가 쓰므로 추가·삭제 불가). 캘린더에 보이는 이름과 색만 바꾼다.
 * - 색은 #RRGGBB만 받는다(스타일 주입 방지). 글자색은 바탕 밝기로 검정/흰색을 자동으로 고른다.
 */

export type CalendarLabel = { id: string; name: string; color: string; sortOrder: number; isActive: boolean };
export type StatusStyle = { name: string; color: string };
export type StatusStyles = Record<AppointmentStatus, StatusStyle>;

export const LABEL_NAME_MAX = 20;
export const STATUS_NAME_MAX = 10;
export const MAX_LABELS = 60;
/** 예약 한 건에 붙일 수 있는 라벨 수 */
export const MAX_LABELS_PER_APPOINTMENT = 10;

const HEX = /^#[0-9A-Fa-f]{6}$/;

export function isHexColor(value: string): boolean {
  return HEX.test(value);
}

function channel(hex: string, offset: number): number {
  const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** 상대 휘도(WCAG) */
export function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

/** 바탕색 위에서 읽기 좋은 글자색. 중간 밝기 파랑·보라는 흰 글씨, 연보라·노랑·하늘색은 검은 글씨 */
export function readableTextColor(background: string): "#000000" | "#FFFFFF" {
  if (!isHexColor(background)) return "#000000";
  return luminance(background) > 0.22 ? "#000000" : "#FFFFFF";
}

/** 기본 상태 표시 — 이름은 지금 화면의 상태 이름, 색은 기존 프로그램 범례(2026-11-12 캡처)에 가깝게 */
export const DEFAULT_STATUS_STYLES: StatusStyles = {
  BOOKED: { name: APPOINTMENT_STATUS_LABEL.BOOKED, color: "#1E73E8" },
  CONFIRMED: { name: APPOINTMENT_STATUS_LABEL.CONFIRMED, color: "#0B57D0" },
  ARRIVED: { name: APPOINTMENT_STATUS_LABEL.ARRIVED, color: "#1D2FD9" },
  IN_TREATMENT: { name: APPOINTMENT_STATUS_LABEL.IN_TREATMENT, color: "#2E9E3E" },
  PAID: { name: APPOINTMENT_STATUS_LABEL.PAID, color: "#3C3C3C" },
  LEFT: { name: APPOINTMENT_STATUS_LABEL.LEFT, color: "#3C3C3C" },
  NO_SHOW: { name: APPOINTMENT_STATUS_LABEL.NO_SHOW, color: "#B3261E" },
  CANCELED_SAME_DAY: { name: APPOINTMENT_STATUS_LABEL.CANCELED_SAME_DAY, color: "#E00000" },
  CANCELED_ADVANCE: { name: APPOINTMENT_STATUS_LABEL.CANCELED_ADVANCE, color: "#E57373" },
  RESCHEDULED: { name: APPOINTMENT_STATUS_LABEL.RESCHEDULED, color: "#9E9E9E" },
};

function isStatusStyle(value: unknown): value is StatusStyle {
  if (typeof value !== "object" || value === null) return false;
  const { name, color } = value as Record<string, unknown>;
  return (
    typeof name === "string" &&
    name.trim().length > 0 &&
    name.length <= STATUS_NAME_MAX &&
    typeof color === "string" &&
    isHexColor(color)
  );
}

/** DB(clinic_setting.status_styles)에 저장된 값을 기본값 위에 덮는다. 틀린 항목은 기본값으로 둔다. */
export function resolveStatusStyles(stored: unknown): StatusStyles {
  const result = { ...DEFAULT_STATUS_STYLES };
  if (typeof stored !== "object" || stored === null) return result;
  for (const status of APPOINTMENT_STATUSES) {
    const value = (stored as Record<string, unknown>)[status];
    if (isStatusStyle(value)) result[status] = { name: value.name.trim(), color: value.color.toUpperCase() };
  }
  return result;
}

/** 예약에 붙은 라벨 중 칸 색으로 쓸 라벨(순서가 가장 위). 없으면 null */
export function representativeLabel<L extends Pick<CalendarLabel, "id" | "sortOrder">>(
  labelIds: readonly string[],
  labels: readonly L[],
): L | null {
  let best: L | null = null;
  for (const label of labels) {
    if (!labelIds.includes(label.id)) continue;
    if (best === null || label.sortOrder < best.sortOrder) best = label;
  }
  return best;
}
