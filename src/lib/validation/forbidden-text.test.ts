import { describe, expect, it } from "vitest";
import { containsResidentRegistrationNumber } from "./forbidden-text";

// 아래 번호는 모두 지어낸 모양뿐인 값이다(검증 숫자를 맞추지 않음, 절대 규칙 1).
describe("containsResidentRegistrationNumber", () => {
  it.each([
    "900101-1234567",
    "900101 - 2234567",
    "9001011234567",
    "메모 991231-4000000 확인",
    "생일 000229-3000000",
  ])("주민등록번호 모양을 찾는다: %s", (text) => {
    expect(containsResidentRegistrationNumber(text)).toBe(true);
  });

  it.each([
    "010-0123-4567",
    "01001234567",
    "오후 2시 재방문 희망",
    "901301-1234567", // 13월
    "900132-1234567", // 32일
    "900101-9234567", // 성별 자리 9
    "900101-123456", // 뒷자리 6개
    "19900101-1234567", // 앞에 숫자가 더 붙음
    "900101-12345678", // 뒤에 숫자가 더 붙음
    "차트 F000123, 2026-11-12 예약",
  ])("주민등록번호가 아닌 것은 그대로 둔다: %s", (text) => {
    expect(containsResidentRegistrationNumber(text)).toBe(false);
  });
});
