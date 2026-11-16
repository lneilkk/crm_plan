import { describe, expect, it } from "vitest";
import { isLateArrival, noShowAllowedFrom } from "./lateness";

const startAt = new Date("2026-11-11T01:00:00.000Z"); // KST 10:00

describe("isLateArrival", () => {
  it("예약 시각 전이나 정각 도착은 지각이 아니다", () => {
    expect(isLateArrival(startAt, new Date("2026-11-11T00:50:00.000Z"), 15)).toBe(false);
    expect(isLateArrival(startAt, startAt, 15)).toBe(false);
  });

  it("허용시간 안에 도착하면 지각이 아니다", () => {
    expect(isLateArrival(startAt, new Date("2026-11-11T01:14:59.999Z"), 15)).toBe(false);
  });

  it("정확히 허용시간에 도착하면 지각이 아니다", () => {
    expect(isLateArrival(startAt, new Date("2026-11-11T01:15:00.000Z"), 15)).toBe(false);
  });

  it("허용시간을 넘으면 지각이다", () => {
    expect(isLateArrival(startAt, new Date("2026-11-11T01:15:00.001Z"), 15)).toBe(true);
    expect(isLateArrival(startAt, new Date("2026-11-11T02:00:00.000Z"), 15)).toBe(true);
  });

  it("허용시간 설정을 바꾸면 판정이 바뀐다", () => {
    const arrivedAt = new Date("2026-11-11T01:20:00.000Z"); // 20분 뒤
    expect(isLateArrival(startAt, arrivedAt, 15)).toBe(true);
    expect(isLateArrival(startAt, arrivedAt, 30)).toBe(false);
    expect(isLateArrival(startAt, arrivedAt, 0)).toBe(true);
  });
});

describe("noShowAllowedFrom", () => {
  it("예약 시각 + 유예시간", () => {
    expect(noShowAllowedFrom(startAt, 30).toISOString()).toBe("2026-11-11T01:30:00.000Z");
    expect(noShowAllowedFrom(startAt, 0).toISOString()).toBe(startAt.toISOString());
  });
});
