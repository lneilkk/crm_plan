import "server-only";

import { ARRIVED_STATUSES } from "@/lib/domain/appointment";
import { amountAfterDiscount } from "@/lib/domain/treatment";
import { type DateKey, kstDayRange } from "@/lib/time/kst";
import { db } from "@/server/db";

/**
 * 의사·상담자 실적 — F-6. 기간(한국 시간 날짜, 양끝 포함)에 시작한 예약 중 내원한 예약(내원·진료중·수납완료·귀가)만 센다.
 *
 * - 환자 수: 서로 다른 고객 수. 방문 수: 예약 건수. 금액: 예약마다 단가 × (100 − 할인율)%의 합.
 * - 금액은 병원이 정한 기준 단가로 계산한 추정값이다(실제 수납액이 아님, 수납 연계는 2차 개발).
 * - 담당자를 지정하지 않은 예약은 "미지정"으로 묶는다.
 * - 응답에 환자 id·이름·번호가 없다(개수와 금액만).
 */

export type PerformanceLine = { item: string; patients: number; visits: number; amount: number };
export type PerformanceRow = {
  staffId: string | null;
  staffName: string;
  patients: number;
  visits: number;
  amount: number;
  items: PerformanceLine[];
};
export type PerformanceReport = { from: DateKey; to: DateKey; doctors: PerformanceRow[]; counselors: PerformanceRow[] };

type Source = {
  patientId: string;
  treatmentItem: string;
  listPrice: number;
  discountRate: number;
  staffId: string | null;
  staffName: string | null;
};

function group(sources: Source[]): PerformanceRow[] {
  const byStaff = new Map<string, { name: string; id: string | null; rows: Source[] }>();
  for (const source of sources) {
    const key = source.staffId ?? "";
    const entry = byStaff.get(key) ?? { name: source.staffName ?? "미지정", id: source.staffId, rows: [] };
    entry.rows.push(source);
    byStaff.set(key, entry);
  }
  const rows = [...byStaff.values()].map(({ id, name, rows: list }) => {
    const items = new Map<string, Source[]>();
    for (const source of list) items.set(source.treatmentItem, [...(items.get(source.treatmentItem) ?? []), source]);
    const sum = (part: Source[]) => part.reduce((total, s) => total + amountAfterDiscount(s.listPrice, s.discountRate), 0);
    return {
      staffId: id,
      staffName: name,
      patients: new Set(list.map((s) => s.patientId)).size,
      visits: list.length,
      amount: sum(list),
      items: [...items.entries()]
        .map(([item, part]) => ({ item, patients: new Set(part.map((s) => s.patientId)).size, visits: part.length, amount: sum(part) }))
        .sort((a, b) => b.amount - a.amount || b.visits - a.visits || a.item.localeCompare(b.item)),
    };
  });
  // 미지정은 맨 뒤, 나머지는 금액이 큰 순
  return rows.sort((a, b) => Number(a.staffId === null) - Number(b.staffId === null) || b.amount - a.amount);
}

export async function buildPerformanceReport(from: DateKey, to: DateKey): Promise<{ report: PerformanceReport; rows: number }> {
  const appointments = await db.appointment.findMany({
    where: {
      startAt: { gte: kstDayRange(from).start, lt: kstDayRange(to).end },
      status: { in: [...ARRIVED_STATUSES] },
    },
    select: {
      patientId: true,
      treatmentItem: true,
      listPrice: true,
      discountRate: true,
      doctorId: true,
      counselorId: true,
      doctor: { select: { name: true } },
      counselor: { select: { name: true } },
    },
  });
  const base = (a: (typeof appointments)[number]) => ({
    patientId: a.patientId,
    treatmentItem: a.treatmentItem,
    listPrice: a.listPrice,
    discountRate: a.discountRate,
  });
  return {
    report: {
      from,
      to,
      doctors: group(appointments.map((a) => ({ ...base(a), staffId: a.doctorId, staffName: a.doctor?.name ?? null }))),
      counselors: group(
        appointments
          .filter((a) => a.counselorId !== null)
          .map((a) => ({ ...base(a), staffId: a.counselorId, staffName: a.counselor?.name ?? null })),
      ),
    },
    rows: appointments.length,
  };
}
