import { describe, expect, it } from "vitest";
import { DEFAULT_CLINIC_SETTINGS } from "./clinic";
import { amountAfterDiscount, DEFAULT_TREATMENT_ITEM_META, isPremiumItem, treatmentMetaOf } from "./treatment";

describe("예약 항목 구분·단가 (F-5·F-6)", () => {
  it("기본 항목은 모두 구분·단가가 있고, 임플란트·라미네이트·교정·보철·상담은 고가", () => {
    for (const item of DEFAULT_CLINIC_SETTINGS.treatmentItems) expect(DEFAULT_TREATMENT_ITEM_META[item]).toBeDefined();
    for (const item of ["임플란트", "라미네이트", "교정", "보철", "상담"]) {
      expect(isPremiumItem(DEFAULT_TREATMENT_ITEM_META, item)).toBe(true);
    }
    for (const item of ["스케일링", "정기검진", "충치 치료"]) expect(isPremiumItem(DEFAULT_TREATMENT_ITEM_META, item)).toBe(false);
  });

  it("설정에 없는 항목은 일반·단가 0으로 본다", () => {
    expect(treatmentMetaOf({}, "새 항목")).toEqual({ category: "GENERAL", price: 0 });
  });
});

describe("amountAfterDiscount", () => {
  it("단가 × (100 − 할인율)%를 원 단위로 반올림", () => {
    expect(amountAfterDiscount(1_200_000, 0)).toBe(1_200_000);
    expect(amountAfterDiscount(1_200_000, 10)).toBe(1_080_000);
    expect(amountAfterDiscount(15_000, 33)).toBe(10_050);
    expect(amountAfterDiscount(9_999, 50)).toBe(5_000);
    expect(amountAfterDiscount(500_000, 100)).toBe(0);
  });

  it("범위를 벗어난 할인율은 받지 않는다", () => {
    expect(() => amountAfterDiscount(1000, -1)).toThrow(RangeError);
    expect(() => amountAfterDiscount(1000, 101)).toThrow(RangeError);
    expect(() => amountAfterDiscount(1000, 1.5)).toThrow(RangeError);
  });
});
