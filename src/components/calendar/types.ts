import type { AppointmentChannel, AppointmentStatus, VisitReasonCode } from "@/lib/domain/appointment";
import type { BadgeTone } from "@/components/ui";

/**
 * 캘린더 화면이 받는 API 응답 모양 (JSON이라 시각은 ISO 문자열).
 * GET /api/appointments, GET /api/appointments/[id]의 응답과 같아야 한다(src/server/appointments/query.ts).
 */

export type CalendarAppointment = {
  id: string;
  patientId: string;
  patientNameMasked: string;
  phoneLast4: string | null;
  startAt: string;
  endAt: string;
  durationMin: number;
  chair: string;
  doctorId: string | null;
  doctorName: string | null;
  counselorId: string | null;
  treatmentItem: string;
  channel: AppointmentChannel;
  status: AppointmentStatus;
  arrivedAt: string | null;
  originalAppointmentId: string | null;
  isNewPatient: boolean;
};

export type AppointmentDetail = {
  id: string;
  patientId: string;
  patientNameMasked: string;
  isNewPatient: boolean;
  startAt: string;
  endAt: string;
  durationMin: number;
  chair: string;
  doctorId: string | null;
  doctorName: string | null;
  counselorName: string | null;
  treatmentItem: string;
  channel: AppointmentChannel;
  status: AppointmentStatus;
  arrivedAt: string | null;
  originalAppointmentId: string | null;
  memo: string | null;
  createdAt: string;
  history: {
    fromStatus: AppointmentStatus | null;
    toStatus: AppointmentStatus;
    reasonCode: VisitReasonCode | null;
    staffName: string;
    inputDevice: string | null;
    createdAt: string;
  }[];
};

export type DoctorOption = { id: string; name: string };

/** 예약 목록 쿼리 키의 앞부분 — 등록·이동 뒤 이 키로 모두 다시 읽는다 */
export const APPOINTMENTS_QUERY_KEY = ["appointments"] as const;

/** 처리가 끝나 체어를 비운 상태(노쇼·취소·변경) — 흐리게 보인다 */
const DIMMED: readonly AppointmentStatus[] = ["NO_SHOW", "CANCELED_SAME_DAY", "CANCELED_ADVANCE", "RESCHEDULED"];

export function isDimmedStatus(status: AppointmentStatus): boolean {
  return DIMMED.includes(status);
}

export const STATUS_TONE: Record<AppointmentStatus, BadgeTone> = {
  BOOKED: "info",
  CONFIRMED: "success",
  ARRIVED: "neutral",
  IN_TREATMENT: "neutral",
  PAID: "neutral",
  LEFT: "neutral",
  NO_SHOW: "danger",
  CANCELED_SAME_DAY: "muted",
  CANCELED_ADVANCE: "muted",
  RESCHEDULED: "muted",
};

/** 예약 블록 바탕색 */
export function blockColor(status: AppointmentStatus): string {
  if (isDimmedStatus(status)) return "border-slate-300 bg-slate-50 text-slate-500 opacity-60";
  if (status === "BOOKED" || status === "CONFIRMED") return "border-blue-400 bg-blue-50 text-slate-900";
  return "border-green-500 bg-green-50 text-slate-900";
}
