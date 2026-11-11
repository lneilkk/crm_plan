import { describe, expect, it } from "vitest";
import { DEFAULT_CLINIC_SETTINGS } from "@/lib/domain/clinic";
import {
  blockBox,
  buildColumns,
  businessHoursOf,
  columnIndexAt,
  columnKeyOf,
  draggedStart,
  gridRange,
  layoutLanes,
  minutesSinceDayStart,
  minutesToTime,
  rowStarts,
  snapMinutes,
  timeToMinutes,
  UNASSIGNED_COLUMN,
} from "./layout";

const hours = DEFAULT_CLINIC_SETTINGS.businessHours;

describe("시각 변환", () => {
  it("HH:mm과 분을 서로 바꾼다", () => {
    expect(timeToMinutes("09:30")).toBe(570);
    expect(timeToMinutes("00:00")).toBe(0);
    expect(minutesToTime(570)).toBe("09:30");
    expect(minutesToTime(1085)).toBe("18:05");
  });

  it("UTC로 저장된 시각을 한국 시간 그 날짜 0시부터의 분으로 바꾼다", () => {
    // 2026-11-12 10:00 KST = 2026-11-12T01:00Z
    expect(minutesSinceDayStart("2026-11-12", "2026-11-12T01:00:00.000Z")).toBe(600);
    expect(minutesSinceDayStart("2026-11-12", new Date("2026-11-12T01:05:00+09:00"))).toBe(65);
    // UTC 날짜는 전날이지만 한국 시간으로는 그 날 오전 8시
    expect(minutesSinceDayStart("2026-11-12", "2026-11-11T23:00:00.000Z")).toBe(480);
  });
});

describe("진료시간과 격자 범위", () => {
  it("요일별 진료시간을 한국 시간 요일로 고른다", () => {
    expect(businessHoursOf(hours, "2026-11-11")).toEqual({ open: 570, close: 1110 }); // 수
    expect(businessHoursOf(hours, "2026-11-14")).toEqual({ open: 570, close: 840 }); // 토
    expect(businessHoursOf(hours, "2026-11-15")).toBeNull(); // 일 휴진
  });

  it("진료시간을 30분 단위 줄로 나눈다", () => {
    const range = gridRange({ open: 570, close: 1110 }, []);
    expect(range).toEqual({ start: 570, end: 1110 });
    const rows = rowStarts(range!);
    expect(rows).toHaveLength(18);
    expect(rows[0]).toBe(570);
    expect(rows.at(-1)).toBe(1080);
  });

  it("진료시간 밖에 걸친 예약이 있으면 범위를 30분 단위로 넓힌다", () => {
    expect(gridRange({ open: 570, close: 1110 }, [{ start: 545, end: 575 }, { start: 1100, end: 1125 }])).toEqual({
      start: 540,
      end: 1140,
    });
  });

  it("휴진일은 예약이 없으면 null, 있으면 예약 범위", () => {
    expect(gridRange(null, [])).toBeNull();
    expect(gridRange(null, [{ start: 600, end: 650 }])).toEqual({ start: 600, end: 660 });
  });
});

describe("blockBox", () => {
  const range = { start: 570, end: 1110 };

  it("시작 시각과 소요시간으로 위치와 높이를 정한다", () => {
    expect(blockBox({ start: 600, end: 660 }, range, 2)).toEqual({ top: 60, height: 120 });
    expect(blockBox({ start: 570, end: 600 }, range, 2)).toEqual({ top: 0, height: 60 });
  });

  it("격자 밖 부분은 잘라 내고 최소 높이를 지킨다", () => {
    expect(blockBox({ start: 1080, end: 1140 }, range, 2)).toEqual({ top: 1020, height: 60 });
    expect(blockBox({ start: 600, end: 605 }, range, 2, 24)).toEqual({ top: 60, height: 24 });
  });
});

describe("layoutLanes (겹치는 예약 나란히)", () => {
  it("겹치지 않으면 모두 한 칸", () => {
    const lanes = layoutLanes([
      { id: "a", start: 600, end: 630 },
      { id: "b", start: 630, end: 660 },
    ]);
    expect(lanes.get("a")).toEqual({ lane: 0, lanes: 1 });
    expect(lanes.get("b")).toEqual({ lane: 0, lanes: 1 });
  });

  it("겹치면 나란히 놓고, 이어져 겹치는 묶음은 같은 칸 수를 쓴다", () => {
    const lanes = layoutLanes([
      { id: "a", start: 600, end: 690 },
      { id: "b", start: 610, end: 640 },
      { id: "c", start: 650, end: 700 },
      { id: "d", start: 720, end: 750 },
    ]);
    expect(lanes.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get("b")).toEqual({ lane: 1, lanes: 2 });
    // b가 끝난 칸을 c가 다시 쓴다
    expect(lanes.get("c")).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get("d")).toEqual({ lane: 0, lanes: 1 });
  });

  it("세 개가 동시에 겹치면 세 칸", () => {
    const lanes = layoutLanes([
      { id: "x", start: 600, end: 660 },
      { id: "y", start: 600, end: 630 },
      { id: "z", start: 620, end: 640 },
    ]);
    expect([...lanes.values()].map((v) => v.lanes)).toEqual([3, 3, 3]);
    expect(new Set([...lanes.values()].map((v) => v.lane))).toEqual(new Set([0, 1, 2]));
    // 긴 예약이 먼저(왼쪽)
    expect(lanes.get("x")!.lane).toBe(0);
  });
});

describe("끌어 옮기기 맞춤", () => {
  const range = { start: 570, end: 1110 };

  it("가까운 5분·10분 단위로 맞춘다", () => {
    expect(snapMinutes(604, 10)).toBe(600);
    expect(snapMinutes(606, 10)).toBe(610);
    expect(snapMinutes(602, 5)).toBe(600);
    expect(snapMinutes(603, 5)).toBe(605);
  });

  it("움직인 픽셀을 분으로 바꿔 맞춘다 (분당 2px)", () => {
    expect(draggedStart(600, 0, 2, 10, 30, range)).toBe(600);
    expect(draggedStart(600, 58, 2, 10, 30, range)).toBe(630); // 29분 → 30분
    expect(draggedStart(600, -21, 2, 10, 30, range)).toBe(590); // -10.5분 → -10분
    expect(draggedStart(605, 0, 2, 10, 30, range)).toBe(610); // 10분 단위로 맞춘다
    expect(draggedStart(605, 0, 2, 5, 30, range)).toBe(605);
  });

  it("격자 밖으로는 옮기지 않는다", () => {
    expect(draggedStart(600, -1000, 2, 10, 30, range)).toBe(570);
    expect(draggedStart(600, 5000, 2, 10, 60, range)).toBe(1050);
  });

  it("가로 위치로 열을 고르고 바깥이면 양끝 열", () => {
    expect(columnIndexAt(0, 500, 5)).toBe(0);
    expect(columnIndexAt(250, 500, 5)).toBe(2);
    expect(columnIndexAt(499, 500, 5)).toBe(4);
    expect(columnIndexAt(-30, 500, 5)).toBe(0);
    expect(columnIndexAt(800, 500, 5)).toBe(4);
  });
});

describe("열 만들기", () => {
  const chairs = DEFAULT_CLINIC_SETTINGS.chairs;
  const doctors = [
    { id: "d1", name: "김의사" },
    { id: "d2", name: "이의사" },
  ];

  it("체어별은 설정의 체어 순서", () => {
    const columns = buildColumns("chair", chairs, doctors, []);
    expect(columns.map((c) => c.key)).toEqual(["C1", "C2", "C3", "C4", "R1"]);
    expect(columns[0]).toEqual({ key: "C1", label: "체어 1", chair: "C1" });
  });

  it("의사별은 의사 + 미지정", () => {
    const columns = buildColumns("doctor", chairs, doctors, []);
    expect(columns.map((c) => c.label)).toEqual(["김의사", "이의사", "미지정"]);
    expect(columns[2]).toEqual({ key: UNASSIGNED_COLUMN, label: "미지정", doctorId: null });
  });

  it("목록에 없는 체어·의사의 예약이 있으면 열을 덧붙인다", () => {
    const items = [
      { chair: "C9", doctorId: "d9", doctorName: "박의사" },
      { chair: "C1", doctorId: null },
    ];
    expect(buildColumns("chair", chairs, doctors, items).map((c) => c.key)).toEqual(["C1", "C2", "C3", "C4", "R1", "C9"]);
    expect(buildColumns("doctor", chairs, doctors, items).map((c) => c.label)).toEqual(["김의사", "이의사", "미지정", "박의사"]);
  });

  it("예약의 열 키", () => {
    expect(columnKeyOf("chair", { chair: "C2", doctorId: "d1" })).toBe("C2");
    expect(columnKeyOf("doctor", { chair: "C2", doctorId: "d1" })).toBe("d1");
    expect(columnKeyOf("doctor", { chair: "C2", doctorId: null })).toBe(UNASSIGNED_COLUMN);
  });
});
