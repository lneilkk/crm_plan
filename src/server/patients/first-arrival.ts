import "server-only";

import { ARRIVED_STATUSES } from "@/lib/domain/appointment";
import type { VisitType } from "@/lib/domain/patient";
import { isNewPatientAt } from "@/lib/patients/new-patient";
import { db, type DbClient } from "@/server/db";

/**
 * 고객별 첫 내원 예약 시각 — 신환·구환 판정(F-4, src/lib/patients/new-patient.ts)에 쓴다.
 * 내원 처리된 상태(내원·진료중·수납완료·귀가)의 예약 중 가장 이른 예약 시각. 신환으로 등록한 고객만 찾는다.
 */
export async function firstArrivalStarts(
  patients: readonly { id: string; visitType: VisitType }[],
  client: DbClient = db,
): Promise<Map<string, Date>> {
  const ids = [...new Set(patients.filter((p) => p.visitType === "NEW").map((p) => p.id))];
  if (ids.length === 0) return new Map();
  const rows = await client.appointment.groupBy({
    by: ["patientId"],
    where: { patientId: { in: ids }, status: { in: [...ARRIVED_STATUSES] } },
    _min: { startAt: true },
  });
  return new Map(rows.flatMap((row) => (row._min.startAt ? [[row.patientId, row._min.startAt] as const] : [])));
}

/** 고객 목록을 받아 신환 여부를 붙이는 함수를 돌려준다(at: 예약 시각, 없으면 지금 기준) */
export async function newPatientJudge(patients: readonly { id: string; visitType: VisitType }[], client: DbClient = db) {
  const first = await firstArrivalStarts(patients, client);
  return (patient: { id: string; visitType: VisitType }, at?: Date) =>
    isNewPatientAt(patient.visitType, first.get(patient.id) ?? null, at);
}
