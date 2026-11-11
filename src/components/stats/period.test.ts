import { describe, expect, it } from "vitest";
import { bucketLabel, periodError, presetPeriod } from "./period";

// 2026-11-11은 수요일
const TODAY = "2026-11-11";

describe("presetPeriod", () => {
  it("이번 주는 월요일부터 오늘까지", () => {
    expect(presetPeriod("thisWeek", TODAY)).toEqual({ from: "2026-11-09", to: TODAY });
  });

  it("지난 주는 지난 월요일~일요일", () => {
    expect(presetPeriod("lastWeek", TODAY)).toEqual({ from: "2026-11-02", to: "2026-11-08" });
  });

  it("월요일에 '이번 주'는 그날 하루", () => {
    expect(presetPeriod("thisWeek", "2026-11-09")).toEqual({ from: "2026-11-09", to: "2026-11-09" });
  });

  it("이번 달·지난 달", () => {
    expect(presetPeriod("thisMonth", TODAY)).toEqual({ from: "2026-11-01", to: TODAY });
    expect(presetPeriod("lastMonth", TODAY)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("1월의 지난 달은 전년 12월", () => {
    expect(presetPeriod("lastMonth", "2027-01-15")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("최근 3개월은 오늘 포함 90일", () => {
    expect(presetPeriod("last3Months", TODAY)).toEqual({ from: "2026-08-14", to: TODAY });
  });

  it("직접 선택은 범위가 없다", () => {
    expect(presetPeriod("custom", TODAY)).toBeNull();
  });
});

describe("periodError", () => {
  it("정상 기간은 null", () => {
    expect(periodError({ from: "2025-11-11", to: "2026-11-11" })).toBeNull(); // 366일
  });

  it("빈 날짜, 순서가 뒤바뀐 기간, 366일 초과", () => {
    expect(periodError({ from: "", to: TODAY })).toMatch("모두 고르세요");
    expect(periodError({ from: "2026-11-12", to: TODAY })).toMatch("늦습니다");
    expect(periodError({ from: "2025-11-10", to: TODAY })).toMatch("366일");
  });
});

describe("bucketLabel", () => {
  it("일·주·월", () => {
    expect(bucketLabel("2026-11-03", "day")).toBe("11/3 (화)");
    expect(bucketLabel("2026-11-02", "week")).toBe("11/2 주");
    expect(bucketLabel("2026-11", "month")).toBe("2026년 11월");
  });

  it("일 라벨에는 한국어 요일이 붙는다 (일요일·해 바뀜)", () => {
    expect(bucketLabel("2026-11-08", "day")).toBe("11/8 (일)");
    expect(bucketLabel("2026-11-09", "day")).toBe("11/9 (월)");
    expect(bucketLabel("2027-01-01", "day")).toBe("1/1 (금)");
  });
});
