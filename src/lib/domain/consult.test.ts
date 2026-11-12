import { describe, expect, it } from "vitest";
import { DEFAULT_CONSULT_OUTCOMES, kindOfOutcome, resolveConsultOutcomes, resultOfKind, summarizeConsultations } from "./consult";

describe("상담 결과 분류 (F-10)", () => {
  it("기본값에 네 종류가 모두 있고, 저장값이 깨졌으면 기본값", () => {
    expect(new Set(DEFAULT_CONSULT_OUTCOMES.map((o) => o.kind))).toEqual(new Set(["PENDING", "SURGERY", "GENERAL", "FAILED"]));
    expect(resolveConsultOutcomes(null)).toEqual(DEFAULT_CONSULT_OUTCOMES);
    expect(resolveConsultOutcomes([{ name: "", color: "#000000", kind: "PENDING" }])).toEqual(DEFAULT_CONSULT_OUTCOMES);
    expect(resolveConsultOutcomes([{ name: "진행", color: "#123456", kind: "SURGERY" }])).toEqual([{ name: "진행", color: "#123456", kind: "SURGERY" }]);
  });

  it("종류 → 전환 결과(T6-2): 수술예약은 예약 전환, 일반진료·실패는 미전환, 대기는 미정", () => {
    expect(resultOfKind("SURGERY")).toBe("BOOKED");
    expect(resultOfKind("GENERAL")).toBe("NOT_BOOKED");
    expect(resultOfKind("FAILED")).toBe("NOT_BOOKED");
    expect(resultOfKind("PENDING")).toBe("PENDING");
  });

  it("분류 이름 → 종류. 목록에 없으면 대기", () => {
    expect(kindOfOutcome(DEFAULT_CONSULT_OUTCOMES, "수술예약")).toBe("SURGERY");
    expect(kindOfOutcome(DEFAULT_CONSULT_OUTCOMES, "없는 분류")).toBe("PENDING");
    expect(kindOfOutcome(DEFAULT_CONSULT_OUTCOMES, null)).toBe("PENDING");
  });
});

describe("summarizeConsultations", () => {
  it("신환·구환 상담 수, 종류별 수, 전환율(수술예약 ÷ 끝난 상담), 상담자별", () => {
    const rows = [
      { counselorId: "a", isNewPatient: true, outcome: "수술예약" },
      { counselorId: "a", isNewPatient: true, outcome: "실패" },
      { counselorId: "a", isNewPatient: false, outcome: "일반진료" },
      { counselorId: "b", isNewPatient: false, outcome: "수술예약" },
      { counselorId: "b", isNewPatient: true, outcome: null },
    ];
    const s = summarizeConsultations(rows, DEFAULT_CONSULT_OUTCOMES);
    expect(s.total).toMatchObject({ count: 5, newPatient: 3, returning: 2, SURGERY: 2, GENERAL: 1, FAILED: 1, PENDING: 1, conversionRate: 0.5 });
    expect(s.byOutcome["수술예약"]).toBe(2);
    expect(s.byCounselor.a).toMatchObject({ count: 3, SURGERY: 1, conversionRate: 1 / 3 });
    expect(s.byCounselor.b).toMatchObject({ count: 2, SURGERY: 1, conversionRate: 1 });
  });

  it("끝난 상담이 없으면 전환율 null", () => {
    expect(summarizeConsultations([{ counselorId: "a", isNewPatient: true, outcome: "대기" }], DEFAULT_CONSULT_OUTCOMES).total.conversionRate).toBeNull();
  });
});
