import type { VisitType } from "@/lib/domain/patient";

/**
 * 신환·구환 판정 — F-4(피드백). 화면 이름은 신환(새 환자)·구환(기존 환자).
 *
 * - 등록 구분(patient.visit_type)이 구환이면 구환이다(기존 CRM에서 옮겨 온 고객, 직원이 구환으로 등록한 고객).
 * - 신환으로 등록했어도 한 번이라도 내원하면 그 뒤로는 자동으로 구환이다.
 *   firstArrivalStart는 그 고객의 내원 처리된 예약 중 가장 이른 예약 시각이다.
 * - at을 주면 '그 예약 시점'의 판정이다: 첫 내원 예약 그 자체(와 그 전 예약)는 신환으로 보인다.
 *   at이 없으면 지금 기준(내원한 적이 있으면 구환).
 */
export function isNewPatientAt(visitType: VisitType, firstArrivalStart: Date | null, at?: Date): boolean {
  if (visitType !== "NEW") return false;
  if (firstArrivalStart === null) return true;
  return at !== undefined && firstArrivalStart.getTime() >= at.getTime();
}

/** 이름 비교용: 공백을 모두 지우고 소문자로 */
function nameKey(name: string): string {
  return name.replace(/\s+/g, "").toLowerCase();
}

/** 같은 사람 이름인지 (공백·대소문자 차이는 무시). 등록할 때 이름+번호가 같으면 기존 고객으로 본다. */
export function isSamePersonName(a: string, b: string): boolean {
  const key = nameKey(a);
  return key.length > 0 && key === nameKey(b);
}
