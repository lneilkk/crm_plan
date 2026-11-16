import "server-only";

import { isSamePersonName } from "@/lib/patients/new-patient";
import { normalizePhone } from "@/lib/phone";
import { hashPhone } from "@/server/crypto/pii";
import type { DbClient } from "@/server/db";

/**
 * 가져오기 공통 — F-7. 보고서는 행 번호(엑셀 기준)와 코드·개수만 담는다(이름·번호 원문 금지, 절대 규칙 6).
 */

export type ImportRow = Record<string, string>;

export type ImportReport = {
  dryRun: boolean;
  total: number;
  /** 새로 넣은(시험 실행이면 넣을) 행 */
  created: number;
  /** 이미 있어서 건너뛴 행 (같은 파일을 다시 넣어도 중복이 생기지 않는다) */
  existing: number;
  /** 사유별로 건너뛴 행 수 (동의 미확인 등) */
  skipped: Record<string, number>;
  /** 넣었지만 기본값을 쓴 칸 수 (시각 없음 → 09:00 등) */
  notes: Record<string, number>;
  /** 넣지 못한 행: 엑셀 행 번호와 오류 코드 */
  errors: { row: number; code: string }[];
};

export function emptyReport(dryRun: boolean, total: number): ImportReport {
  return { dryRun, total, created: 0, existing: 0, skipped: {}, notes: {}, errors: [] };
}

export function bump(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

/** 오류 목록이 너무 길지 않게 (개수는 total에서 셀 수 있다) */
export const MAX_ERRORS_REPORTED = 200;

export function addError(report: ImportReport, row: number, code: string): void {
  if (report.errors.length < MAX_ERRORS_REPORTED) report.errors.push({ row, code });
  bump(report.skipped, `error:${code}`);
}

type PatientKey = { id: string; name: string; phoneHash: string; dentwebChartNo: string | null };

/**
 * 행의 고객 찾기: 차트번호가 있으면 차트번호(대소문자 무시), 없으면 이름+휴대폰(공백·대소문자 무시).
 * 묶음 전체를 한 번에 읽는다.
 */
export async function patientMatcher(client: DbClient, rows: ImportRow[]) {
  const chartNos = [...new Set(rows.map((r) => (r.chartNo ?? "").trim().toUpperCase()).filter(Boolean))];
  const phoneHashes = [
    ...new Set(rows.flatMap((r) => {
      const normalized = normalizePhone(r.phone ?? "");
      return normalized ? [hashPhone(normalized)] : [];
    })),
  ];
  const candidates: PatientKey[] =
    chartNos.length + phoneHashes.length === 0
      ? []
      : await client.patient.findMany({
          where: {
            OR: [
              ...(chartNos.length ? [{ dentwebChartNo: { in: chartNos } }] : []),
              ...(phoneHashes.length ? [{ phoneHash: { in: phoneHashes } }] : []),
            ],
          },
          select: { id: true, name: true, phoneHash: true, dentwebChartNo: true },
        });
  const byChart = new Map(candidates.filter((p) => p.dentwebChartNo).map((p) => [p.dentwebChartNo!.toUpperCase(), p]));
  return (row: ImportRow): PatientKey | null => {
    const chart = (row.chartNo ?? "").trim().toUpperCase();
    if (chart) return byChart.get(chart) ?? null;
    const normalized = normalizePhone(row.phone ?? "");
    if (!normalized || !row.name?.trim()) return null;
    const hash = hashPhone(normalized);
    return candidates.find((p) => p.phoneHash === hash && isSamePersonName(p.name, row.name)) ?? null;
  };
}

/** 직원 이름 → id (역할 제한, 활성만). 이름이 같은 직원이 둘 이상이면 연결하지 않는다. */
export async function staffByName(client: DbClient, roles: readonly ("DOCTOR" | "COUNSELOR" | "ADMIN")[]) {
  const staff = await client.staff.findMany({ where: { isActive: true, role: { in: [...roles] } }, select: { id: true, name: true } });
  const counts = new Map<string, number>();
  for (const s of staff) counts.set(s.name, (counts.get(s.name) ?? 0) + 1);
  return (name: string | undefined): string | null => {
    const n = (name ?? "").trim();
    if (!n || counts.get(n) !== 1) return null;
    return staff.find((s) => s.name === n)?.id ?? null;
  };
}

export function splitList(text: string | undefined, max: number, itemMax: number): string[] {
  return [...new Set((text ?? "").split(/[,，/;|]/).map((v) => v.trim()).filter(Boolean))].slice(0, max).map((v) => v.slice(0, itemMax));
}
