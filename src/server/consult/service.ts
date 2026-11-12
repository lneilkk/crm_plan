import "server-only";

import {
  type ConsultOutcome,
  kindOfOutcome,
  resolveConsultOutcomes,
  resultOfKind,
  summarizeConsultations,
} from "@/lib/domain/consult";
import { isPremiumItem } from "@/lib/domain/treatment";
import type { AppointmentChannel } from "@/lib/domain/appointment";
import { maskName } from "@/lib/masking";
import { type DateKey, kstDateKey, kstDayRange } from "@/lib/time/kst";
import { ApiError } from "@/server/api/errors";
import { createAppointment } from "@/server/appointments/create";
import { getClinicSettings } from "@/server/appointments/settings";
import type { DbClient } from "@/server/db";
import { newPatientJudge } from "@/server/patients/first-arrival";

/**
 * 상담 — F-10(Task.md T6-1·T6-2).
 * - 상담 내용은 민감정보다(기획서 10장): 그 고객에게 민감정보 동의(철회 안 됨)가 있을 때만 저장한다.
 *   동의 기록이 없으면 등록할 때 '동의 받음'을 확인해야 하고, 확인하면 동의 기록을 남긴다.
 * - 목록에는 내용을 넣지 않고(상세에서만), 이름은 마스킹한다. 보기 권한(consult.read)이 없는 프론트·간호는 볼 수 없다.
 * - 수술예약 전환(T6-2): 상담에서 바로 고가 항목 예약을 만들고 상담에 연결한다(상담자 = 예약의 상담자 → 실적).
 * - client는 route의 ctx.db(감사 행과 같은 트랜잭션)다.
 */

export async function getConsultOutcomes(client: DbClient): Promise<ConsultOutcome[]> {
  const row = await client.clinicSetting.findUnique({ where: { id: 1 }, select: { consultOutcomes: true } });
  return resolveConsultOutcomes(row?.consultOutcomes ?? null);
}

const listSelect = {
  id: true,
  patientId: true,
  counselorId: true,
  consultedAt: true,
  interestedItems: true,
  outcome: true,
  result: true,
  isNewPatient: true,
  appointmentId: true,
  patient: { select: { name: true } },
  counselor: { select: { name: true } },
  appointment: { select: { startAt: true, treatmentItem: true, status: true } },
} as const;

type Row = Awaited<ReturnType<typeof findRows>>[number];
function findRows(client: DbClient, where: object) {
  return client.consultation.findMany({ where, select: listSelect, orderBy: [{ consultedAt: "asc" }, { id: "asc" }] });
}

function toItem(row: Row) {
  return {
    id: row.id,
    patientId: row.patientId,
    patientNameMasked: maskName(row.patient.name),
    isNewPatient: row.isNewPatient,
    counselorId: row.counselorId,
    counselorName: row.counselor.name,
    consultedAt: row.consultedAt.toISOString(),
    interestedItems: row.interestedItems,
    outcome: row.outcome,
    result: row.result,
    appointment: row.appointmentId && row.appointment
      ? { id: row.appointmentId, startAt: row.appointment.startAt.toISOString(), treatmentItem: row.appointment.treatmentItem, status: row.appointment.status }
      : null,
  };
}
export type ConsultListItem = ReturnType<typeof toItem>;

export async function listConsultations(client: DbClient, date: DateKey) {
  const { start, end } = kstDayRange(date);
  const rows = await findRows(client, { consultedAt: { gte: start, lt: end } });
  return rows.map(toItem);
}

export async function getConsultation(client: DbClient, id: string) {
  const row = await client.consultation.findUnique({ where: { id }, select: { ...listSelect, content: true } });
  if (!row) throw new ApiError(404, "NOT_FOUND", "상담 기록을 찾을 수 없습니다.");
  return { ...toItem(row), content: row.content };
}

async function hasSensitiveConsent(client: DbClient, patientId: string): Promise<boolean> {
  const latest = await client.consent.findFirst({
    where: { patientId, type: "SENSITIVE" },
    orderBy: { createdAt: "desc" },
    select: { agreed: true, withdrawnAt: true },
  });
  return latest !== null && latest.agreed && latest.withdrawnAt === null;
}

async function assertCounselor(client: DbClient, id: string): Promise<void> {
  const staff = await client.staff.findUnique({ where: { id }, select: { role: true, isActive: true } });
  if (!staff || !staff.isActive || !["COUNSELOR", "ADMIN"].includes(staff.role)) {
    throw new ApiError(400, "INVALID_COUNSELOR", "상담자를 다시 고르세요.");
  }
}

function assertOutcome(outcomes: ConsultOutcome[], name: string | undefined | null): void {
  if (name != null && !outcomes.some((o) => o.name === name)) throw new ApiError(400, "UNKNOWN_OUTCOME", "없는 상담 결과입니다. 화면을 새로 고치세요.");
}

export type CreateConsultationInput = {
  patientId: string;
  counselorId: string;
  consultedAt: Date;
  content: string;
  interestedItems: string[];
  outcome?: string | null;
  /** 이 상담에서 민감정보 처리 동의를 받았음 (동의 기록이 없을 때 필수) */
  consentObtained?: boolean;
};

export async function createConsultation(client: DbClient, input: CreateConsultationInput, actorId: string, now: Date) {
  const patient = await client.patient.findUnique({ where: { id: input.patientId }, select: { id: true, visitType: true } });
  if (!patient) throw new ApiError(404, "PATIENT_NOT_FOUND", "고객을 찾을 수 없습니다.");
  await assertCounselor(client, input.counselorId);
  const outcomes = await getConsultOutcomes(client);
  assertOutcome(outcomes, input.outcome);

  if (!(await hasSensitiveConsent(client, patient.id))) {
    if (!input.consentObtained) {
      throw new ApiError(409, "CONSENT_REQUIRED", "이 고객은 민감정보 처리 동의 기록이 없습니다. 동의를 받은 뒤 '동의 받음'을 체크하세요.");
    }
    await client.consent.create({ data: { patientId: patient.id, type: "SENSITIVE", agreed: true, agreedAt: now, recordedById: actorId } });
  }
  const isNew = (await newPatientJudge([{ id: patient.id, visitType: patient.visitType }], client))(
    { id: patient.id, visitType: patient.visitType },
    input.consultedAt,
  );
  const outcome = input.outcome ?? outcomes.find((o) => o.kind === "PENDING")?.name ?? null;
  const created = await client.consultation.create({
    data: {
      patientId: patient.id,
      counselorId: input.counselorId,
      consultedAt: input.consultedAt,
      content: input.content,
      interestedItems: input.interestedItems,
      outcome,
      result: resultOfKind(kindOfOutcome(outcomes, outcome)),
      isNewPatient: isNew,
    },
    select: { id: true },
  });
  return { id: created.id, patientId: patient.id };
}

export async function updateConsultation(
  client: DbClient,
  id: string,
  input: { content?: string; interestedItems?: string[]; outcome?: string; counselorId?: string },
) {
  const current = await client.consultation.findUnique({ where: { id }, select: { patientId: true } });
  if (!current) throw new ApiError(404, "NOT_FOUND", "상담 기록을 찾을 수 없습니다.");
  const outcomes = await getConsultOutcomes(client);
  assertOutcome(outcomes, input.outcome);
  if (input.counselorId) await assertCounselor(client, input.counselorId);
  await client.consultation.update({
    where: { id },
    data: {
      content: input.content,
      interestedItems: input.interestedItems,
      counselorId: input.counselorId,
      outcome: input.outcome,
      result: input.outcome === undefined ? undefined : resultOfKind(kindOfOutcome(outcomes, input.outcome)),
    },
  });
  return { patientId: current.patientId };
}

export type BookSurgeryInput = {
  startAt: Date;
  durationMin: number;
  chair: string;
  treatmentItem: string;
  doctorId?: string | null;
  channel: Exclude<AppointmentChannel, "WALK_IN">;
  memo?: string | null;
};

/** 상담 → 수술예약 (T6-2). 고가 항목만, 지난 날짜 불가, 한 상담에 예약 하나. */
export async function bookSurgery(
  client: DbClient,
  id: string,
  input: BookSurgeryInput,
  options: { actorId: string; inputDevice: string | null; now: Date },
) {
  const consultation = await client.consultation.findUnique({ where: { id }, select: { patientId: true, counselorId: true, appointmentId: true } });
  if (!consultation) throw new ApiError(404, "NOT_FOUND", "상담 기록을 찾을 수 없습니다.");
  if (consultation.appointmentId) throw new ApiError(409, "ALREADY_BOOKED", "이미 수술예약으로 연결된 상담입니다.");
  const settings = await getClinicSettings(client);
  if (!isPremiumItem(settings.treatmentItemMeta, input.treatmentItem)) {
    throw new ApiError(400, "NOT_SURGERY_ITEM", "수술예약은 고가(상담 대상) 항목만 고를 수 있습니다.");
  }
  if (kstDateKey(input.startAt) < kstDateKey(options.now)) throw new ApiError(400, "PAST_DATE", "지난 날짜로는 예약할 수 없습니다.");
  const appointment = await createAppointment(
    { ...input, patientId: consultation.patientId, counselorId: consultation.counselorId },
    { actorId: options.actorId, inputDevice: options.inputDevice, tx: client },
  );
  const outcomes = await getConsultOutcomes(client);
  await client.consultation.update({
    where: { id },
    data: { appointmentId: appointment.id, outcome: outcomes.find((o) => o.kind === "SURGERY")?.name ?? "수술예약", result: "BOOKED" },
  });
  return { appointmentId: appointment.id, patientId: consultation.patientId };
}

export async function consultationStats(client: DbClient, from: DateKey, to: DateKey) {
  const rows = await client.consultation.findMany({
    where: { consultedAt: { gte: kstDayRange(from).start, lt: kstDayRange(to).end } },
    select: { counselorId: true, isNewPatient: true, outcome: true, counselor: { select: { name: true } } },
  });
  const outcomes = await getConsultOutcomes(client);
  const summary = summarizeConsultations(rows, outcomes);
  const names = new Map(rows.map((r) => [r.counselorId, r.counselor.name]));
  return {
    from,
    to,
    total: summary.total,
    byOutcome: summary.byOutcome,
    byCounselor: Object.entries(summary.byCounselor).map(([counselorId, counts]) => ({ counselorId, counselorName: names.get(counselorId) ?? "-", ...counts })),
    rows: rows.length,
  };
}
