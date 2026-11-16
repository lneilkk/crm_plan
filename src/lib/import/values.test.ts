import { describe, expect, it } from "vitest";
import {
  cellToText,
  isResidentNumberHeader,
  parseConsent,
  parseDateKey,
  parseGender,
  parseReferral,
  parseStatus,
  parseTime,
} from "./values";

describe("cellToText (엑셀 칸 → 글자)", () => {
  it("날짜 칸(Date)은 시간대 없는 엑셀 값이므로 UTC 성분을 그대로 'YYYY-MM-DD HH:mm'으로", () => {
    expect(cellToText(new Date(Date.UTC(2026, 10, 1, 10, 30)))).toBe("2026-11-01 10:30");
    expect(cellToText(new Date(Date.UTC(1980, 6, 7)))).toBe("1980-07-07 00:00");
  });
  it("숫자·불리언·빈 값", () => {
    expect(cellToText(1012345678)).toBe("1012345678");
    expect(cellToText(true)).toBe("true");
    expect(cellToText(null)).toBe("");
    expect(cellToText("  가상  ")).toBe("가상");
  });
});

describe("parseDateKey / parseTime", () => {
  it("여러 날짜 표기를 YYYY-MM-DD로", () => {
    for (const text of ["2026-11-01", "2026.11.01", "2026/11/1", "20261101", "2026-11-01 10:30", "2026. 11. 1."]) {
      expect(parseDateKey(text)).toBe("2026-11-01");
    }
    expect(parseDateKey("2026-02-30")).toBeNull();
    expect(parseDateKey("어제")).toBeNull();
  });
  it("시각: HH:mm, 오전/오후, 날짜와 함께 쓴 값", () => {
    expect(parseTime("9:05")).toBe("09:05");
    expect(parseTime("2026-11-01 14:30")).toBe("14:30");
    expect(parseTime("오후 2:30")).toBe("14:30");
    expect(parseTime("오전 12:10")).toBe("00:10");
    expect(parseTime("25:00")).toBeNull();
    expect(parseTime("")).toBeNull();
  });
});

describe("코드 값 해석", () => {
  it("성별", () => {
    expect(parseGender("남")).toBe("MALE");
    expect(parseGender("여자")).toBe("FEMALE");
    expect(parseGender("F")).toBe("FEMALE");
    expect(parseGender("?")).toBeNull();
  });
  it("유입경로: 모르는 값은 기타", () => {
    expect(parseReferral("네이버 예약")).toBe("PLATFORM");
    expect(parseReferral("홈페이지")).toBe("WEBSITE");
    expect(parseReferral("지인 소개")).toBe("REFERRAL");
    expect(parseReferral("전화")).toBe("PHONE");
    expect(parseReferral("현수막")).toBe("OTHER");
    expect(parseReferral("")).toBeNull();
  });
  it("예약 상태 문구", () => {
    expect(parseStatus("내원")).toBe("ARRIVED");
    expect(parseStatus("진료완료")).toBe("LEFT");
    expect(parseStatus("노쇼")).toBe("NO_SHOW");
    expect(parseStatus("미내원")).toBe("NO_SHOW");
    expect(parseStatus("당일취소")).toBe("CANCELED_SAME_DAY");
    expect(parseStatus("취소")).toBe("CANCELED_ADVANCE");
    expect(parseStatus("예약")).toBe("BOOKED");
    expect(parseStatus("")).toBe("BOOKED");
    expect(parseStatus("알수없음")).toBeNull();
  });
  it("동의 여부", () => {
    for (const yes of ["Y", "예", "동의", "O", "1", "true"]) expect(parseConsent(yes)).toBe(true);
    for (const no of ["N", "아니오", "미동의", "", "X"]) expect(parseConsent(no)).toBe(false);
  });
});

describe("isResidentNumberHeader (절대 규칙 3)", () => {
  it("주민번호 열 이름을 알아본다", () => {
    for (const header of ["주민번호", "주민등록번호", "주민 번호", "RRN", "jumin"]) expect(isResidentNumberHeader(header)).toBe(true);
    for (const header of ["이름", "생년월일", "전화번호"]) expect(isResidentNumberHeader(header)).toBe(false);
  });
});

describe("guessMapping", () => {
  it("열 이름으로 항목을 고르고 주민번호 열은 쓰지 않는다", async () => {
    const { guessMapping } = await import("./fields");
    const mapping = guessMapping("patients", ["고객명", "주민등록번호", "휴대폰 번호", "생년월일", "차트번호", "비고"]);
    expect(mapping).toMatchObject({ name: 0, phone: 2, birthDate: 3, chartNo: 4, memo: 5, gender: null });
    expect(Object.values(mapping)).not.toContain(1);
  });
});
