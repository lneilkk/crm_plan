import "server-only";

import { maskName } from "@/lib/masking";
import { phoneLast4 } from "@/lib/phone";
import { type DateKey, kstDayRange } from "@/lib/time/kst";
import { ApiError } from "@/server/api/errors";
import { openPhone, PiiDecryptError } from "@/server/crypto/pii";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { newPatientJudge } from "@/server/patients/first-arrival";

/**
 * 예약 조회 — T4-1. 캘린더 목록(기간)과 예약 한 건 상세.
 * 이름은 마스킹하고, 전화번호는 뒷 4자리만 내보낸다(기획서 10장).
 */

/** 한 번에 조회할 수 있는 최대 일수 (6주 = 월 달력 한 화면) */
export const MAX_RANGE_DAYS = 42;

export type AppointmentFilter = { from: DateKey; to: DateKey; chair?: string; doctorId?: string };

/** 복호화한 번호의 뒷 4자리. 저장된 값이 깨졌으면 목록 전체를 막지 않고 null (키 설정 오류는 그대로 500). */
function last4Of(phoneEnc: string, appointmentId: string): string | null {
  try {
    return phoneLast4(openPhone(phoneEnc));
  } catch (error) {
    if (!(error instanceof PiiDecryptError)) throw error;
    log.warn("appointments.phone_decrypt_failed", { appointmentId });
    return null;
  }
}

/** from~to(한국 시간 날짜, 양끝 포함)에 시작하는 예약 */
export async function listAppointments(filter: AppointmentFilter) {
  const start = kstDayRange(filter.from).start;
  const end = kstDayRange(filter.to).end;
  const rows = await db.appointment.findMany({
    where: {
      startAt: { gte: start, lt: end },
      ...(filter.chair ? { chair: filter.chair } : {}),
      ...(filter.doctorId ? { doctorId: filter.doctorId } : {}),
    },
    include: {
      patient: { select: { name: true, phoneEnc: true, visitType: true, referralSource: true } },
      doctor: { select: { name: true } },
      labels: { select: { labelId: true } },
    },
    orderBy: [{ startAt: "asc" }, { chair: "asc" }, { id: "asc" }],
  });
  const isNew = await newPatientJudge(rows.map((row) => ({ id: row.patientId, visitType: row.patient.visitType })));
  return rows.map((row) => ({
    id: row.id,
    patientId: row.patientId,
    patientNameMasked: maskName(row.patient.name),
    phoneLast4: last4Of(row.patient.phoneEnc, row.id),
    startAt: row.startAt,
    endAt: row.endAt,
    durationMin: row.durationMin,
    chair: row.chair,
    doctorId: row.doctorId,
    doctorName: row.doctor?.name ?? null,
    counselorId: row.counselorId,
    treatmentItem: row.treatmentItem,
    channel: row.channel,
    status: row.status,
    arrivedAt: row.arrivedAt,
    originalAppointmentId: row.originalAppointmentId,
    isNewPatient: isNew({ id: row.patientId, visitType: row.patient.visitType }, row.startAt),
    referralSource: row.patient.referralSource,
    labelIds: row.labels.map((link) => link.labelId),
    /** 메모가 있는지만 (내용은 상세에서) — F-8 */
    hasMemo: row.memo !== null && row.memo.length > 0,
  }));
}

/** 예약 한 건과 상태 이력 */
export async function getAppointmentDetail(id: string) {
  const row = await db.appointment.findUnique({
    where: { id },
    include: {
      patient: { select: { name: true, visitType: true } },
      doctor: { select: { name: true } },
      counselor: { select: { name: true } },
      labels: { select: { labelId: true } },
      participants: { select: { staffId: true, staff: { select: { name: true, role: true } } }, orderBy: { createdAt: "asc" } },
      statusLogs: {
        include: { staff: { select: { name: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!row) throw new ApiError(404, "NOT_FOUND", "예약을 찾을 수 없습니다.");
  const isNew = await newPatientJudge([{ id: row.patientId, visitType: row.patient.visitType }]);
  return {
    id: row.id,
    patientId: row.patientId,
    patientNameMasked: maskName(row.patient.name),
    isNewPatient: isNew({ id: row.patientId, visitType: row.patient.visitType }, row.startAt),
    startAt: row.startAt,
    endAt: row.endAt,
    durationMin: row.durationMin,
    chair: row.chair,
    doctorId: row.doctorId,
    doctorName: row.doctor?.name ?? null,
    counselorId: row.counselorId,
    counselorName: row.counselor?.name ?? null,
    treatmentItem: row.treatmentItem,
    channel: row.channel,
    status: row.status,
    arrivedAt: row.arrivedAt,
    originalAppointmentId: row.originalAppointmentId,
    memo: row.memo,
    /** 수술 참여 직원 (F-11) */
    participants: row.participants.map((p) => ({ staffId: p.staffId, name: p.staff.name, role: p.staff.role })),
    listPrice: row.listPrice,
    discountRate: row.discountRate,
    labelIds: row.labels.map((link) => link.labelId),
    createdAt: row.createdAt,
    history: row.statusLogs.map((entry) => ({
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      reasonCode: entry.reasonCode,
      staffName: entry.staff.name,
      inputDevice: entry.inputDevice,
      createdAt: entry.createdAt,
    })),
  };
}
