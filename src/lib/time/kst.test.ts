import { describe, expect, it } from "vitest";
import {
  addDays,
  diffDays,
  formatKstDateLabel,
  formatKstShortDate,
  formatKstTime,
  isSameKstDay,
  isValidDateKey,
  isValidTime,
  kstDateKey,
  kstDateTime,
  kstDayRange,
  kstDayStart,
  kstMinutesOfDay,
  kstMonthKey,
  kstWeekStart,
  kstWeekday,
} from "./kst";

describe("kstDateKey", () => {
  it("UTC 15:00은 한국 시간으로 다음 날 00:00이다", () => {
    expect(kstDateKey(new Date("2026-11-10T15:00:00.000Z"))).toBe("2026-11-11");
  });

  it("UTC 14:59:59는 아직 한국 시간으로 같은 날이다", () => {
    expect(kstDateKey(new Date("2026-11-10T14:59:59.999Z"))).toBe("2026-11-10");
  });

  it("연말 경계를 넘는다", () => {
    expect(kstDateKey(new Date("2026-12-31T15:00:00.000Z"))).toBe("2027-01-01");
  });
});

describe("kstDayStart / kstDayRange", () => {
  it("하루의 시작은 한국 시간 00:00 (UTC 전날 15:00)", () => {
    expect(kstDayStart("2026-11-11").toISOString()).toBe("2026-11-10T15:00:00.000Z");
  });

  it("범위는 [시작, 다음 날 시작)", () => {
    const { start, end } = kstDayRange("2026-11-11");
    expect(start.toISOString()).toBe("2026-11-10T15:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-11T15:00:00.000Z");
  });

  it("kstDateKey와 서로 역연산이다", () => {
    const { start, end } = kstDayRange("2026-02-28");
    expect(kstDateKey(start)).toBe("2026-02-28");
    expect(kstDateKey(new Date(end.getTime() - 1))).toBe("2026-02-28");
    expect(kstDateKey(end)).toBe("2026-03-01");
  });
});

describe("kstDateTime", () => {
  it("한국 시간 09:30은 UTC 00:30", () => {
    expect(kstDateTime("2026-11-11", "09:30").toISOString()).toBe("2026-11-11T00:30:00.000Z");
  });

  it("한국 시간 00:00은 UTC 전날 15:00", () => {
    expect(kstDateTime("2026-11-11", "00:00").toISOString()).toBe("2026-11-10T15:00:00.000Z");
  });

  it("잘못된 시각 형식은 거부한다", () => {
    expect(() => kstDateTime("2026-11-11", "24:00")).toThrow(RangeError);
    expect(() => kstDateTime("2026-11-11", "9:30")).toThrow(RangeError);
  });
});

describe("kstMinutesOfDay / formatKstTime", () => {
  it("한국 시간 기준 시·분을 돌려준다", () => {
    const instant = new Date("2026-11-11T05:45:00.000Z"); // KST 14:45
    expect(kstMinutesOfDay(instant)).toBe(14 * 60 + 45);
    expect(formatKstTime(instant)).toBe("14:45");
  });

  it("자정 직전·직후", () => {
    expect(formatKstTime(new Date("2026-11-10T14:59:00.000Z"))).toBe("23:59");
    expect(formatKstTime(new Date("2026-11-10T15:00:00.000Z"))).toBe("00:00");
  });
});

describe("요일과 주", () => {
  it("2026-11-11은 수요일", () => {
    expect(kstWeekday("2026-11-11")).toBe(3);
  });

  it("주는 월요일에 시작한다", () => {
    expect(kstWeekStart("2026-11-11")).toBe("2026-11-09"); // 수 → 월
    expect(kstWeekStart("2026-11-09")).toBe("2026-11-09"); // 월 → 그대로
    expect(kstWeekStart("2026-11-15")).toBe("2026-11-09"); // 일 → 그 주 월요일
    expect(kstWeekStart("2026-11-16")).toBe("2026-11-16"); // 다음 주 월요일
  });
});

describe("addDays / diffDays", () => {
  it("월·연 경계를 넘는다", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29"); // 윤년
  });

  it("날짜 차이를 일수로 돌려준다", () => {
    expect(diffDays("2026-11-11", "2026-11-11")).toBe(0);
    expect(diffDays("2026-11-11", "2026-11-12")).toBe(1);
    expect(diffDays("2026-11-11", "2026-11-01")).toBe(-10);
    expect(diffDays("2026-01-01", "2027-01-01")).toBe(365);
  });
});

describe("검증", () => {
  it("올바른 날짜만 통과한다", () => {
    expect(isValidDateKey("2026-11-11")).toBe(true);
    expect(isValidDateKey("2026-02-30")).toBe(false);
    expect(isValidDateKey("2026-13-01")).toBe(false);
    expect(isValidDateKey("2026-1-1")).toBe(false);
    expect(isValidDateKey("20261111")).toBe(false);
  });

  it("올바른 시각만 통과한다", () => {
    expect(isValidTime("00:00")).toBe(true);
    expect(isValidTime("23:59")).toBe(true);
    expect(isValidTime("24:00")).toBe(false);
    expect(isValidTime("12:60")).toBe(false);
  });

  it("잘못된 날짜를 받으면 예외를 던진다", () => {
    expect(() => kstDayStart("2026-02-30")).toThrow(RangeError);
    expect(() => addDays("오늘", 1)).toThrow(RangeError);
  });
});

describe("기타", () => {
  it("kstMonthKey", () => {
    expect(kstMonthKey("2026-11-11")).toBe("2026-11");
  });

  it("isSameKstDay는 한국 시간 날짜로 비교한다", () => {
    const lateNight = new Date("2026-11-10T14:00:00.000Z"); // KST 11/10 23:00
    const afterMidnight = new Date("2026-11-10T15:30:00.000Z"); // KST 11/11 00:30
    expect(isSameKstDay(lateNight, afterMidnight)).toBe(false);
    expect(isSameKstDay(afterMidnight, new Date("2026-11-11T14:59:00.000Z"))).toBe(true);
  });

  it("표시용 날짜 문구", () => {
    expect(formatKstDateLabel("2026-11-11")).toBe("2026년 11월 11일 (수)");
    expect(formatKstShortDate("2026-11-11")).toBe("11/11 (수)");
  });
});
