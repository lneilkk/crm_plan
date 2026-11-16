import { describe, expect, it } from "vitest";
import { maskBirthDate, maskName } from "./masking";

describe("maskName", () => {
  it("세 글자 이름은 가운데를 가린다", () => {
    expect(maskName("홍길동")).toBe("홍*동");
  });

  it("네 글자 이상은 첫 글자와 마지막 글자만 남긴다", () => {
    expect(maskName("남궁민수")).toBe("남**수");
    expect(maskName("가나다라마")).toBe("가***마");
  });

  it("두 글자 이름은 첫 글자만 남긴다", () => {
    expect(maskName("이산")).toBe("이*");
  });

  it("한 글자·빈 값", () => {
    expect(maskName("김")).toBe("*");
    expect(maskName("")).toBe("");
    expect(maskName("  ")).toBe("");
  });

  it("앞뒤 공백은 무시한다", () => {
    expect(maskName(" 홍길동 ")).toBe("홍*동");
  });
});

describe("maskBirthDate", () => {
  it("연도만 남긴다", () => {
    expect(maskBirthDate("1990-05-17")).toBe("1990-**-**");
  });
});
