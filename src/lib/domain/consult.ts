/**
 * 상담 결과 분류와 통계 — F-10(Task.md T6-1·T6-2).
 *
 * - 분류(outcome): 병원이 정하는 이름표(예: 예진완료·사진완료·수술예약·일반진료·실패). 관리자가 [편집]에서 고친다.
 * - 종류(kind): 통계용 네 가지 — PENDING(대기·진행 중), SURGERY(수술예약 전환), GENERAL(일반진료로 진행), FAILED(실패·불가).
 *   전환율 = 수술예약 ÷ 끝난 상담(수술예약 + 일반진료 + 실패). 대기는 분모에 넣지 않는다.
 * - 전환 결과(consultation.result, T6-2): 수술예약 → BOOKED, 일반진료·실패 → NOT_BOOKED, 대기 → PENDING.
 */

export const CONSULT_OUTCOME_KINDS = ["PENDING", "SURGERY", "GENERAL", "FAILED"] as const;
export type ConsultOutcomeKind = (typeof CONSULT_OUTCOME_KINDS)[number];

export const CONSULT_OUTCOME_KIND_LABEL: Record<ConsultOutcomeKind, string> = {
  PENDING: "대기·진행",
  SURGERY: "수술예약",
  GENERAL: "일반진료",
  FAILED: "실패·불가",
};

export type ConsultOutcome = { name: string; color: string; kind: ConsultOutcomeKind };

export const DEFAULT_CONSULT_OUTCOMES: ConsultOutcome[] = [
  { name: "대기", color: "#B0BEC5", kind: "PENDING" },
  { name: "예진완료", color: "#90CAF9", kind: "PENDING" },
  { name: "사진완료", color: "#80DEEA", kind: "PENDING" },
  { name: "보류", color: "#FFE082", kind: "PENDING" },
  { name: "수술예약", color: "#7E57C2", kind: "SURGERY" },
  { name: "일반진료", color: "#4FC3F7", kind: "GENERAL" },
  { name: "실패", color: "#81C784", kind: "FAILED" },
  { name: "임플불가", color: "#E57373", kind: "FAILED" },
];

export const CONSULT_OUTCOME_NAME_MAX = 12;
export const MAX_CONSULT_OUTCOMES = 20;

function isOutcome(value: unknown): value is ConsultOutcome {
  if (typeof value !== "object" || value === null) return false;
  const { name, color, kind } = value as Record<string, unknown>;
  return (
    typeof name === "string" &&
    name.trim().length > 0 &&
    name.length <= CONSULT_OUTCOME_NAME_MAX &&
    typeof color === "string" &&
    /^#[0-9A-Fa-f]{6}$/.test(color) &&
    typeof kind === "string" &&
    (CONSULT_OUTCOME_KINDS as readonly string[]).includes(kind)
  );
}

/** 저장된 분류 목록(clinic_setting.consult_outcomes). 비었거나 하나라도 깨졌으면 기본값 */
export function resolveConsultOutcomes(stored: unknown): ConsultOutcome[] {
  if (!Array.isArray(stored) || stored.length === 0 || !stored.every(isOutcome)) return DEFAULT_CONSULT_OUTCOMES;
  return stored.map((o) => ({ name: o.name.trim(), color: o.color.toUpperCase(), kind: o.kind }));
}

export function kindOfOutcome(outcomes: readonly ConsultOutcome[], name: string | null): ConsultOutcomeKind {
  return outcomes.find((o) => o.name === name)?.kind ?? "PENDING";
}

export function resultOfKind(kind: ConsultOutcomeKind): "PENDING" | "BOOKED" | "NOT_BOOKED" {
  if (kind === "SURGERY") return "BOOKED";
  if (kind === "PENDING") return "PENDING";
  return "NOT_BOOKED";
}

export type ConsultCounts = Record<ConsultOutcomeKind, number> & {
  count: number;
  newPatient: number;
  returning: number;
  /** 수술예약 ÷ (수술예약 + 일반진료 + 실패). 끝난 상담이 없으면 null */
  conversionRate: number | null;
};

function emptyCounts(): ConsultCounts {
  return { count: 0, newPatient: 0, returning: 0, PENDING: 0, SURGERY: 0, GENERAL: 0, FAILED: 0, conversionRate: null };
}

function addRate(c: ConsultCounts): ConsultCounts {
  const done = c.SURGERY + c.GENERAL + c.FAILED;
  return { ...c, conversionRate: done === 0 ? null : c.SURGERY / done };
}

export function summarizeConsultations(
  rows: readonly { counselorId: string; isNewPatient: boolean; outcome: string | null }[],
  outcomes: readonly ConsultOutcome[],
): { total: ConsultCounts; byOutcome: Record<string, number>; byCounselor: Record<string, ConsultCounts> } {
  const total = emptyCounts();
  const byOutcome: Record<string, number> = {};
  const byCounselor: Record<string, ConsultCounts> = {};
  for (const row of rows) {
    const kind = kindOfOutcome(outcomes, row.outcome);
    const counselor = (byCounselor[row.counselorId] ??= emptyCounts());
    for (const c of [total, counselor]) {
      c.count += 1;
      if (row.isNewPatient) c.newPatient += 1;
      else c.returning += 1;
      c[kind] += 1;
    }
    const name = row.outcome ?? outcomes.find((o) => o.kind === "PENDING")?.name ?? "대기";
    byOutcome[name] = (byOutcome[name] ?? 0) + 1;
  }
  return {
    total: addRate(total),
    byOutcome,
    byCounselor: Object.fromEntries(Object.entries(byCounselor).map(([k, v]) => [k, addRate(v)])),
  };
}
