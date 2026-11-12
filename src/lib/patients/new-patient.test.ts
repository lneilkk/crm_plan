import { describe, expect, it } from "vitest";
import { isNewPatientAt, isSamePersonName } from "./new-patient";

describe("isNewPatientAt (신환·구환)", () => {
  const first = new Date("2026-11-10T01:00:00Z");

  it("등록 구분이 구환이면 내원 기록이 없어도 구환(기존 CRM에서 옮겨 온 고객 등)", () => {
    expect(isNewPatientAt("RETURNING", null)).toBe(false);
  });

  it("신환으로 등록했고 내원한 적이 없으면 신환", () => {
    expect(isNewPatientAt("NEW", null)).toBe(true);
    expect(isNewPatientAt("NEW", null, new Date("2026-12-01T00:00:00Z"))).toBe(true);
  });

  it("한 번이라도 내원하면 그 뒤로는 구환 (예약 기준: 첫 내원 예약 자체는 신환)", () => {
    expect(isNewPatientAt("NEW", first)).toBe(false); // 지금 기준
    expect(isNewPatientAt("NEW", first, first)).toBe(true); // 첫 내원 예약 그 자체
    expect(isNewPatientAt("NEW", first, new Date("2026-11-09T01:00:00Z"))).toBe(true); // 첫 내원 전 예약
    expect(isNewPatientAt("NEW", first, new Date("2026-11-11T01:00:00Z"))).toBe(false); // 그 뒤 예약
  });
});

describe("isSamePersonName", () => {
  it("공백·대소문자만 다른 이름은 같은 이름", () => {
    expect(isSamePersonName("홍길동", " 홍 길동 ")).toBe(true);
    expect(isSamePersonName("Kim Minsu", "kim  minsu")).toBe(true);
  });

  it("글자가 다르면 다른 이름", () => {
    expect(isSamePersonName("홍길동", "홍길순")).toBe(false);
    expect(isSamePersonName("홍길동", "")).toBe(false);
  });
});
