import "server-only";

import { maskName } from "@/lib/masking";
import { type DateKey, kstDayRange } from "@/lib/time/kst";
import { getClinicSettings } from "@/server/appointments/settings";
import { newPatientJudge } from "@/server/patients/first-arrival";
import { db } from "@/server/db";
import { type BoardSource, buildBoard } from "./rows";

/**
 * 내원 보드 조회 — T5-3. 그날(한국 시간) 시작하는 예약을 읽어 행과 요약을 만든다(rows.ts).
 * 이름은 마스킹해서만 내보내고 전화번호는 읽지 않는다. 캐시하지 않는다.
 */
export async function getBoard(date: DateKey, now: Date) {
  const settings = await getClinicSettings();
  const { start, end } = kstDayRange(date);
  const appointments = await db.appointment.findMany({
    where: { startAt: { gte: start, lt: end } },
    select: {
      id: true,
      patientId: true,
      startAt: true,
      durationMin: true,
      chair: true,
      status: true,
      arrivedAt: true,
      treatmentItem: true,
      channel: true,
      doctor: { select: { name: true } },
      counselor: { select: { name: true } },
      patient: { select: { name: true, visitType: true, referralSource: true } },
    },
  });

  // 신환 배지 (F-4): 신환으로 등록했고 이 예약보다 앞서 내원한 예약이 없을 때
  const isNew = await newPatientJudge(appointments.map((a) => ({ id: a.patientId, visitType: a.patient.visitType })));

  const sources: BoardSource[] = appointments.map((a) => {
    return {
      id: a.id,
      patientId: a.patientId,
      nameMasked: maskName(a.patient.name),
      startAt: a.startAt,
      durationMin: a.durationMin,
      chair: a.chair,
      status: a.status,
      arrivedAt: a.arrivedAt,
      treatmentItem: a.treatmentItem,
      channel: a.channel,
      doctorName: a.doctor?.name ?? null,
      counselorName: a.counselor?.name ?? null,
      referralSource: a.patient.referralSource,
      isNew: isNew({ id: a.patientId, visitType: a.patient.visitType }, a.startAt),
    };
  });

  return {
    date,
    serverNow: now.toISOString(),
    lateToleranceMin: settings.lateToleranceMin,
    noShowGraceMin: settings.noShowGraceMin,
    ...buildBoard(sources, settings, now),
  };
}

export type BoardResponse = Awaited<ReturnType<typeof getBoard>>;
