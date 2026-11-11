import { describe, expect, it } from "vitest";
import { formatPhone, isLast4Query, maskPhone, normalizePhone, phoneLast4 } from "./phone";

describe("normalizePhone", () => {
  it("구분 기호를 없애고 숫자만 남긴다", () => {
    expect(normalizePhone("010-0000-1234")).toBe("01000001234");
    expect(normalizePhone("010 0000 1234")).toBe("01000001234");
    expect(normalizePhone("010.0000.1234")).toBe("01000001234");
    expect(normalizePhone(" 01000001234 ")).toBe("01000001234");
  });

  it("국가번호(+82) 표기를 국내 표기로 바꾼다", () => {
    expect(normalizePhone("+82 10-0000-1234")).toBe("01000001234");
    expect(normalizePhone("+82-010-0000-1234")).toBe("01000001234");
  });

  it("지역번호·070 번호도 받는다", () => {
    expect(normalizePhone("02-000-1234")).toBe("020001234");
    expect(normalizePhone("031-000-1234")).toBe("0310001234");
    expect(normalizePhone("070-0000-1234")).toBe("07000001234");
  });

  it("형식이 맞지 않으면 null", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("1234")).toBeNull();
    expect(normalizePhone("10-0000-1234")).toBeNull(); // 0으로 시작하지 않음
    expect(normalizePhone("010-0000-12345678")).toBeNull(); // 너무 김
    expect(normalizePhone("전화없음")).toBeNull();
  });
});

describe("phoneLast4 / isLast4Query", () => {
  it("뒷 4자리를 돌려준다", () => {
    expect(phoneLast4("01000001234")).toBe("1234");
  });

  it("숫자 4개만 뒷자리 검색어로 본다", () => {
    expect(isLast4Query("1234")).toBe(true);
    expect(isLast4Query(" 1234 ")).toBe(true);
    expect(isLast4Query("123")).toBe(false);
    expect(isLast4Query("12345")).toBe(false);
    expect(isLast4Query("12a4")).toBe(false);
  });
});

describe("formatPhone / maskPhone", () => {
  it("휴대폰 번호", () => {
    expect(formatPhone("01000001234")).toBe("010-0000-1234");
    expect(maskPhone("01000001234")).toBe("010-****-1234");
  });

  it("가운데가 3자리인 옛 번호", () => {
    expect(formatPhone("0110001234")).toBe("011-000-1234");
    expect(maskPhone("0110001234")).toBe("011-***-1234");
  });

  it("서울 지역번호는 2자리", () => {
    expect(formatPhone("020001234")).toBe("02-000-1234");
    expect(formatPhone("0200001234")).toBe("02-0000-1234");
    expect(maskPhone("0200001234")).toBe("02-****-1234");
  });

  it("마스킹 결과에 가운데 자리 숫자가 남지 않는다", () => {
    expect(maskPhone("01098765432")).not.toContain("9876");
  });
});
