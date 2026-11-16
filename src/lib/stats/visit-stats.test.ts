import { describe, expect, it } from "vitest";
import { APPOINTMENT_STATUSES, type AppointmentStatus } from "@/lib/domain/appointment";
import { kstDateTime } from "@/lib/time/kst";
import {
  bucketKeysInRange,
  bucketVisits,
  emptyVisitStats,
  fillBucketGaps,
  formatRate,
  summarizeVisits,
  type VisitRow,
  type VisitStats,
} from "./visit-stats";

/**
 * 가짜 예약 31건 — 손 계산용 표. (사람을 식별하는 값은 없다: 시각·상태·도착 시각뿐)
 *
 * 지각 허용시간 15분, 기준 시각(asOf) = 2026-11-04(수) 12:00 KST.
 * 3개 주(월요일 10-19, 10-26, 11-02)에 걸쳐 있고, 둘째 주(10-26~11-01)가 월 경계를 넘는다.
 *
 *  #  날짜(KST)   시각   상태               도착                    분류
 * ── 1주차 (월요일 2026-10-19) ─────────────────────────────────────────────
 *  1  10-20(화)  10:00  ARRIVED            10:00 (정각)            내원
 *  2  10-20      10:30  ARRIVED            10:45:00.000 (+15분)    내원 (허용 한계 정각 → 지각 아님)
 *  3  10-20      11:00  ARRIVED            11:15:00.001 (+15분 1ms) 내원 + 지각
 *  4  10-20      14:00  NO_SHOW            -                       노쇼
 *  5  10-20      15:00  CANCELED_SAME_DAY  -                       당일취소
 *  6  10-22(목)  09:30  IN_TREATMENT       09:50 (+20분)           내원 + 지각
 *  7  10-22      10:00  PAID               09:55 (-5분)            내원
 *  8  10-22      13:00  CANCELED_ADVANCE   -                       사전취소 (분모 제외)
 *  9  10-22      16:00  RESCHEDULED        -                       예약변경 (분모 제외)
 * 10  10-24(토)  10:00  CANCELED_ADVANCE   -                       사전취소 (분모 제외)
 * 11  10-24      11:00  RESCHEDULED        -                       예약변경 (분모 제외)
 * ── 2주차 (월요일 2026-10-26, 10월 → 11월) ────────────────────────────────
 * 12  10-28(수)  09:00  ARRIVED            09:10 (+10분)           내원
 * 13  10-28      10:00  NO_SHOW            -                       노쇼
 * 14  10-28      11:00  NO_SHOW            -                       노쇼
 * 15  10-28      14:00  BOOKED             -                       미확인 (asOf 이전)
 * 16  10-31(토)  10:00  LEFT               10:16 (+16분)           내원 + 지각
 * 17  10-31      11:00  CANCELED_SAME_DAY  -                       당일취소
 * 18  10-31      12:00  PAID               없음(null)              내원 (도착 시각 없음 → 지각 판정 불가, 지각 아님)
 * 19  10-31      23:50  LEFT               11-01 00:20 (+30분)     내원 + 지각 (도착은 다음 날이지만 예약일 10-31에 집계)
 * 20  11-01(일)  00:10  ARRIVED            00:12 (+2분)            내원 (UTC로는 10-31 15:10 → KST 기준 11월)
 * 21  11-01      10:00  CONFIRMED          -                       미확인 (asOf 이전)
 * 22  11-01      11:00  CANCELED_SAME_DAY  -                       당일취소
 * ── 3주차 (월요일 2026-11-02) ─────────────────────────────────────────────
 * 23  11-03(화)  09:00  ARRIVED            09:05 (+5분)            내원
 * 24  11-03      10:00  IN_TREATMENT       10:40 (+40분)           내원 + 지각
 * 25  11-03      11:00  NO_SHOW            -                       노쇼
 * 26  11-03      15:00  CANCELED_ADVANCE   -                       사전취소 (분모 제외)
 * 27  11-04(수)  09:00  PAID               09:00 (정각)            내원
 * 28  11-04      11:00  BOOKED             -                       미확인 (11:00 ≤ asOf 12:00)
 * 29  11-04      14:00  BOOKED             -                       대기 (14:00 > asOf 12:00, 분모 제외)
 * 30  11-06(금)  10:00  BOOKED             -                       대기 (분모 제외)
 * 31  11-06      11:00  CONFIRMED          -                       대기 (분모 제외)
 *
 * 손 계산 — 유효 예약(분모) = 내원 + 노쇼 + 당일취소 + 미확인
 *
 *  일별     내원 지각 노쇼 당일 사전 변경 미확인 대기 | 유효 | 실내원율 노쇼율 당일취소율 지각률
 *  10-20     3    1    1    1    0    0    0     0   |  5   |  3/5     1/5    1/5       1/3
 *  10-22     2    1    0    0    1    1    0     0   |  2   |  2/2     0/2    0/2       1/2
 *  10-24     0    0    0    0    1    1    0     0   |  0   |  -       -      -         -
 *  10-28     1    0    2    0    0    0    1     0   |  4   |  1/4     2/4    0/4       0/1
 *  10-31     3    2    0    1    0    0    0     0   |  4   |  3/4     0/4    1/4       2/3
 *  11-01     1    0    0    1    0    0    1     0   |  3   |  1/3     0/3    1/3       0/1
 *  11-03     2    1    1    0    1    0    0     0   |  3   |  2/3     1/3    0/3       1/2
 *  11-04     1    0    0    0    0    0    1     1   |  2   |  1/2     0/2    0/2       0/1
 *  11-06     0    0    0    0    0    0    0     2   |  0   |  -       -      -         -
 *
 *  주별 (일별 행을 더한 값)
 *  10-19     5    2    1    1    2    2    0     0   |  7   |  5/7     1/7    1/7       2/5     (10-20 + 10-22 + 10-24)
 *  10-26     5    2    2    2    0    0    2     0   | 11   |  5/11    2/11   2/11      2/5     (10-28 + 10-31 + 11-01)
 *  11-02     3    1    1    0    1    0    1     3   |  5   |  3/5     1/5    0/5       1/3     (11-03 + 11-04 + 11-06)
 *
 *  월별
 *  2026-10   9    4    3    2    2    2    1     0   | 15   |  9/15    3/15   2/15      4/9     (#1~#19)
 *  2026-11   4    1    1    1    1    0    2     3   |  8   |  4/8     1/8    1/8       1/4     (#20~#31)
 *
 *  전체     13    5    4    3    3    2    3     3   | 23   | 13/23    4/23   3/23      5/13
 *  (검산: 13 + 4 + 3 + 3 + 2 + 3 + 3 = 31건)
 */

const LATE_TOLERANCE_MIN = 15;
const AS_OF = kstDateTime("2026-11-04", "12:00");
const OPTIONS = { asOf: AS_OF, lateToleranceMin: LATE_TOLERANCE_MIN };

/**
 * 표의 한 줄. arrival은 예약 시각 기준 도착 시각의 차이(분, 밀리초)이고 생략하면 도착 시각 없음(null).
 */
function row(
  date: string,
  time: string,
  status: AppointmentStatus,
  arrival?: { min: number; ms?: number },
): VisitRow {
  const startAt = kstDateTime(date, time);
  const arrivedAt = arrival ? new Date(startAt.getTime() + arrival.min * 60_000 + (arrival.ms ?? 0)) : null;
  return { startAt, status, arrivedAt };
}

const ROWS: VisitRow[] = [
  // 1주차
  row("2026-10-20", "10:00", "ARRIVED", { min: 0 }), // #1
  row("2026-10-20", "10:30", "ARRIVED", { min: 15 }), // #2 허용 한계 정각
  row("2026-10-20", "11:00", "ARRIVED", { min: 15, ms: 1 }), // #3 허용 한계 + 1ms
  row("2026-10-20", "14:00", "NO_SHOW"), // #4
  row("2026-10-20", "15:00", "CANCELED_SAME_DAY"), // #5
  row("2026-10-22", "09:30", "IN_TREATMENT", { min: 20 }), // #6
  row("2026-10-22", "10:00", "PAID", { min: -5 }), // #7
  row("2026-10-22", "13:00", "CANCELED_ADVANCE"), // #8
  row("2026-10-22", "16:00", "RESCHEDULED"), // #9
  row("2026-10-24", "10:00", "CANCELED_ADVANCE"), // #10
  row("2026-10-24", "11:00", "RESCHEDULED"), // #11
  // 2주차
  row("2026-10-28", "09:00", "ARRIVED", { min: 10 }), // #12
  row("2026-10-28", "10:00", "NO_SHOW"), // #13
  row("2026-10-28", "11:00", "NO_SHOW"), // #14
  row("2026-10-28", "14:00", "BOOKED"), // #15
  row("2026-10-31", "10:00", "LEFT", { min: 16 }), // #16
  row("2026-10-31", "11:00", "CANCELED_SAME_DAY"), // #17
  row("2026-10-31", "12:00", "PAID"), // #18 도착 시각 없음
  row("2026-10-31", "23:50", "LEFT", { min: 30 }), // #19
  row("2026-11-01", "00:10", "ARRIVED", { min: 2 }), // #20
  row("2026-11-01", "10:00", "CONFIRMED"), // #21
  row("2026-11-01", "11:00", "CANCELED_SAME_DAY"), // #22
  // 3주차
  row("2026-11-03", "09:00", "ARRIVED", { min: 5 }), // #23
  row("2026-11-03", "10:00", "IN_TREATMENT", { min: 40 }), // #24
  row("2026-11-03", "11:00", "NO_SHOW"), // #25
  row("2026-11-03", "15:00", "CANCELED_ADVANCE"), // #26
  row("2026-11-04", "09:00", "PAID", { min: 0 }), // #27
  row("2026-11-04", "11:00", "BOOKED"), // #28
  row("2026-11-04", "14:00", "BOOKED"), // #29
  row("2026-11-06", "10:00", "BOOKED"), // #30
  row("2026-11-06", "11:00", "CONFIRMED"), // #31
];

/** 손 계산 표의 한 줄을 그대로 옮겨 적는다 (순서: 표의 열 순서) */
function expected(
  counts: [
    arrived: number,
    late: number,
    noShow: number,
    sameDayCancel: number,
    advanceCancel: number,
    rescheduled: number,
    unconfirmed: number,
    upcoming: number,
  ],
  booked: number,
  rates: [
    arrivalRate: number | null,
    noShowRate: number | null,
    sameDayCancelRate: number | null,
    lateRate: number | null,
  ],
): VisitStats {
  const [arrived, late, noShow, sameDayCancel, advanceCancel, rescheduled, unconfirmed, upcoming] = counts;
  const [arrivalRate, noShowRate, sameDayCancelRate, lateRate] = rates;
  return {
    arrived,
    late,
    noShow,
    sameDayCancel,
    advanceCancel,
    rescheduled,
    unconfirmed,
    upcoming,
    booked,
    arrivalRate,
    noShowRate,
    sameDayCancelRate,
    lateRate,
  };
}

const EMPTY_STATS = expected([0, 0, 0, 0, 0, 0, 0, 0], 0, [null, null, null, null]);

describe("가짜 데이터 표", () => {
  it("31건이고 경계 사례의 시각이 표와 같다", () => {
    expect(ROWS).toHaveLength(31);
    expect(AS_OF.toISOString()).toBe("2026-11-04T03:00:00.000Z");
    // #2 허용 한계 정각, #3 그보다 1ms 뒤
    expect(ROWS[1].arrivedAt?.toISOString()).toBe("2026-10-20T01:45:00.000Z");
    expect(ROWS[2].arrivedAt?.toISOString()).toBe("2026-10-20T02:15:00.001Z");
    // #19 KST 10-31 23:50 예약, 도착은 KST 11-01 00:20
    expect(ROWS[18].startAt.toISOString()).toBe("2026-10-31T14:50:00.000Z");
    expect(ROWS[18].arrivedAt?.toISOString()).toBe("2026-10-31T15:20:00.000Z");
    // #20 KST 11-01 00:10 = UTC 10-31 15:10
    expect(ROWS[19].startAt.toISOString()).toBe("2026-10-31T15:10:00.000Z");
  });
});

describe("summarizeVisits", () => {
  it("전체 31건의 건수와 비율이 손 계산과 같다", () => {
    expect(summarizeVisits(ROWS, OPTIONS)).toEqual(
      expected([13, 5, 4, 3, 3, 2, 3, 3], 23, [13 / 23, 4 / 23, 3 / 23, 5 / 13]),
    );
  });

  it("유효 예약 = 내원 + 노쇼 + 당일취소 + 미확인 (사전취소·예약변경·대기는 빠진다)", () => {
    const stats = summarizeVisits(ROWS, OPTIONS);
    expect(stats.booked).toBe(23);
    expect(stats.arrived + stats.noShow + stats.sameDayCancel + stats.unconfirmed).toBe(23);
    expect(stats.booked + stats.advanceCancel + stats.rescheduled + stats.upcoming).toBe(31);
  });

  it("진료중·수납완료·귀가도 내원으로 센다", () => {
    const rows = [
      row("2026-10-20", "10:00", "IN_TREATMENT", { min: 0 }),
      row("2026-10-20", "11:00", "PAID", { min: 0 }),
      row("2026-10-20", "12:00", "LEFT", { min: 0 }),
    ];
    expect(summarizeVisits(rows, OPTIONS)).toEqual(expected([3, 0, 0, 0, 0, 0, 0, 0], 3, [1, 0, 0, 0]));
  });

  it("정확히 허용시간에 도착하면 지각이 아니고, 1ms라도 넘으면 지각이다", () => {
    const atLimit = summarizeVisits([ROWS[1]], OPTIONS); // #2
    expect(atLimit.arrived).toBe(1);
    expect(atLimit.late).toBe(0);
    expect(atLimit.lateRate).toBe(0);

    const overLimit = summarizeVisits([ROWS[2]], OPTIONS); // #3
    expect(overLimit.arrived).toBe(1);
    expect(overLimit.late).toBe(1);
    expect(overLimit.lateRate).toBe(1);
  });

  it("허용시간 설정을 바꾸면 지각 건수가 바뀐다", () => {
    // 도착이 예약 시각보다 늦은 내원: #2(+15분) #3(+15분 1ms) #6(+20) #12(+10) #16(+16) #19(+30) #20(+2) #23(+5) #24(+40)
    // 허용 0분 → 9건 모두 지각, 허용 20분 → 20분을 넘는 #19, #24만 지각
    expect(summarizeVisits(ROWS, { asOf: AS_OF, lateToleranceMin: 0 }).late).toBe(9);
    expect(summarizeVisits(ROWS, { asOf: AS_OF, lateToleranceMin: 0 }).lateRate).toBe(9 / 13);
    expect(summarizeVisits(ROWS, { asOf: AS_OF, lateToleranceMin: 20 }).late).toBe(2);
    expect(summarizeVisits(ROWS, { asOf: AS_OF, lateToleranceMin: 20 }).lateRate).toBe(2 / 13);
  });

  it("내원 상태인데 도착 시각이 없으면 내원으로만 세고 지각으로 세지 않는다", () => {
    const stats = summarizeVisits([ROWS[17]], OPTIONS); // #18
    expect(stats).toEqual(expected([1, 0, 0, 0, 0, 0, 0, 0], 1, [1, 0, 0, 0]));
  });

  it("예약 시각이 기준 시각과 같으면 미확인, 1ms라도 뒤면 대기다", () => {
    const due: VisitRow = { startAt: AS_OF, status: "CONFIRMED", arrivedAt: null };
    const notDue: VisitRow = { startAt: new Date(AS_OF.getTime() + 1), status: "CONFIRMED", arrivedAt: null };
    expect(summarizeVisits([due], OPTIONS)).toEqual(expected([0, 0, 0, 0, 0, 0, 1, 0], 1, [0, 0, 0, null]));
    expect(summarizeVisits([notDue], OPTIONS)).toEqual(expected([0, 0, 0, 0, 0, 0, 0, 1], 0, [null, null, null, null]));
  });

  it("기준 시각이 지나면 대기가 미확인으로 바뀌어 분모에 들어온다", () => {
    // 11-07 00:00 KST 기준: 대기였던 #29, #30, #31이 미확인이 된다 → 미확인 3 + 3 = 6, 유효 예약 23 + 3 = 26
    const later = summarizeVisits(ROWS, { asOf: kstDateTime("2026-11-07", "00:00"), lateToleranceMin: 15 });
    expect(later).toEqual(expected([13, 5, 4, 3, 3, 2, 6, 0], 26, [13 / 26, 4 / 26, 3 / 26, 5 / 13]));
  });

  it("빈 입력은 건수 0, 비율은 모두 null이다 (NaN이 아니다)", () => {
    expect(summarizeVisits([], OPTIONS)).toEqual(EMPTY_STATS);
  });

  it("전부 대기면 유효 예약이 0이라 비율은 모두 null이다", () => {
    const upcomingOnly = [ROWS[28], ROWS[29], ROWS[30]]; // #29, #30, #31
    expect(summarizeVisits(upcomingOnly, OPTIONS)).toEqual(
      expected([0, 0, 0, 0, 0, 0, 0, 3], 0, [null, null, null, null]),
    );
  });

  it("사전취소·예약변경만 있으면 유효 예약이 0이라 비율은 모두 null이다", () => {
    const excludedOnly = [ROWS[9], ROWS[10]]; // #10, #11
    expect(summarizeVisits(excludedOnly, OPTIONS)).toEqual(
      expected([0, 0, 0, 0, 1, 1, 0, 0], 0, [null, null, null, null]),
    );
  });

  it("내원이 0이면 지각률만 null이고 나머지 비율은 숫자다", () => {
    const stats = summarizeVisits([ROWS[3], ROWS[4]], OPTIONS); // #4 노쇼, #5 당일취소
    expect(stats).toEqual(expected([0, 0, 1, 1, 0, 0, 0, 0], 2, [0, 1 / 2, 1 / 2, null]));
  });

  it("모든 상태값은 정확히 한 분류에만 들어간다", () => {
    for (const status of APPOINTMENT_STATUSES) {
      const stats = summarizeVisits([row("2026-10-20", "10:00", status)], OPTIONS);
      const classified =
        stats.arrived +
        stats.noShow +
        stats.sameDayCancel +
        stats.advanceCancel +
        stats.rescheduled +
        stats.unconfirmed +
        stats.upcoming;
      expect(classified, status).toBe(1);
    }
  });

  it("입력 배열을 바꾸지 않고, 순서와 무관하게 같은 결과를 낸다", () => {
    const copy = [...ROWS];
    const reversed = [...ROWS].reverse();
    expect(summarizeVisits(reversed, OPTIONS)).toEqual(summarizeVisits(ROWS, OPTIONS));
    expect(ROWS).toEqual(copy);
  });
});

describe("bucketVisits", () => {
  it("일별 집계가 손 계산과 같다 (예약이 있는 날만, 날짜 오름차순)", () => {
    expect(bucketVisits(ROWS, { unit: "day", ...OPTIONS })).toEqual([
      { key: "2026-10-20", stats: expected([3, 1, 1, 1, 0, 0, 0, 0], 5, [3 / 5, 1 / 5, 1 / 5, 1 / 3]) },
      { key: "2026-10-22", stats: expected([2, 1, 0, 0, 1, 1, 0, 0], 2, [1, 0, 0, 1 / 2]) },
      { key: "2026-10-24", stats: expected([0, 0, 0, 0, 1, 1, 0, 0], 0, [null, null, null, null]) },
      { key: "2026-10-28", stats: expected([1, 0, 2, 0, 0, 0, 1, 0], 4, [1 / 4, 2 / 4, 0, 0]) },
      { key: "2026-10-31", stats: expected([3, 2, 0, 1, 0, 0, 0, 0], 4, [3 / 4, 0, 1 / 4, 2 / 3]) },
      { key: "2026-11-01", stats: expected([1, 0, 0, 1, 0, 0, 1, 0], 3, [1 / 3, 0, 1 / 3, 0]) },
      { key: "2026-11-03", stats: expected([2, 1, 1, 0, 1, 0, 0, 0], 3, [2 / 3, 1 / 3, 0, 1 / 2]) },
      { key: "2026-11-04", stats: expected([1, 0, 0, 0, 0, 0, 1, 1], 2, [1 / 2, 0, 0, 0]) },
      { key: "2026-11-06", stats: expected([0, 0, 0, 0, 0, 0, 0, 2], 0, [null, null, null, null]) },
    ]);
  });

  it("주별 집계가 손 계산과 같다 (키는 그 주의 월요일)", () => {
    expect(bucketVisits(ROWS, { unit: "week", ...OPTIONS })).toEqual([
      { key: "2026-10-19", stats: expected([5, 2, 1, 1, 2, 2, 0, 0], 7, [5 / 7, 1 / 7, 1 / 7, 2 / 5]) },
      { key: "2026-10-26", stats: expected([5, 2, 2, 2, 0, 0, 2, 0], 11, [5 / 11, 2 / 11, 2 / 11, 2 / 5]) },
      { key: "2026-11-02", stats: expected([3, 1, 1, 0, 1, 0, 1, 3], 5, [3 / 5, 1 / 5, 0, 1 / 3]) },
    ]);
  });

  it("월별 집계가 손 계산과 같다 (키는 YYYY-MM)", () => {
    expect(bucketVisits(ROWS, { unit: "month", ...OPTIONS })).toEqual([
      { key: "2026-10", stats: expected([9, 4, 3, 2, 2, 2, 1, 0], 15, [9 / 15, 3 / 15, 2 / 15, 4 / 9]) },
      { key: "2026-11", stats: expected([4, 1, 1, 1, 1, 0, 2, 3], 8, [4 / 8, 1 / 8, 1 / 8, 1 / 4]) },
    ]);
  });

  it("한국 시간 날짜로 나눈다: 10-31 23:50은 10월, 11-01 00:10은 11월 (UTC로는 둘 다 10-31)", () => {
    const boundary = [ROWS[18], ROWS[19]]; // #19, #20
    expect(bucketVisits(boundary, { unit: "day", ...OPTIONS }).map((b) => b.key)).toEqual([
      "2026-10-31",
      "2026-11-01",
    ]);
    expect(bucketVisits(boundary, { unit: "month", ...OPTIONS }).map((b) => b.key)).toEqual(["2026-10", "2026-11"]);
    // 토요일과 일요일은 같은 주(월요일 10-26)다
    expect(bucketVisits(boundary, { unit: "week", ...OPTIONS })).toEqual([
      { key: "2026-10-26", stats: expected([2, 1, 0, 0, 0, 0, 0, 0], 2, [1, 0, 0, 1 / 2]) },
    ]);
  });

  it("주도 한국 시간 날짜로 나눈다: 월요일 00:10 KST는 새 주, 일요일 23:50 KST는 앞 주", () => {
    // 표와 별개인 3건. 2026-11-01은 일요일, 2026-11-02는 월요일이다.
    //  A  11-01(일) 23:50 KST = UTC 11-01(일) 14:50  NO_SHOW        → 주 10-26
    //  B  11-02(월) 00:10 KST = UTC 11-01(일) 15:10  ARRIVED 정각   → 주 11-02 (UTC 날짜로 나누면 앞 주 10-26으로 잘못 들어간다)
    //  C  11-02(월) 08:59 KST = UTC 11-01(일) 23:59  ARRIVED +16분  → 주 11-02 (UTC와 날짜가 다른 마지막 1분)
    // 손 계산: 주 10-26 = 노쇼 1, 유효 1 → 0/1, 1/1, 0/1, -
    //          주 11-02 = 내원 2(지각 1), 유효 2 → 2/2, 0/2, 0/2, 1/2
    const sundayNight = row("2026-11-01", "23:50", "NO_SHOW"); // A
    const mondayDawn = row("2026-11-02", "00:10", "ARRIVED", { min: 0 }); // B
    const mondayMorning = row("2026-11-02", "08:59", "ARRIVED", { min: 16 }); // C
    expect(sundayNight.startAt.toISOString()).toBe("2026-11-01T14:50:00.000Z");
    expect(mondayDawn.startAt.toISOString()).toBe("2026-11-01T15:10:00.000Z");
    expect(mondayMorning.startAt.toISOString()).toBe("2026-11-01T23:59:00.000Z");

    expect(bucketVisits([mondayMorning, mondayDawn, sundayNight], { unit: "week", ...OPTIONS })).toEqual([
      { key: "2026-10-26", stats: expected([0, 0, 1, 0, 0, 0, 0, 0], 1, [0, 1, 0, null]) },
      { key: "2026-11-02", stats: expected([2, 1, 0, 0, 0, 0, 0, 0], 2, [1, 0, 0, 1 / 2]) },
    ]);
    // 같은 3건의 일별 키: 주 경계와 날짜 경계가 같은 자정(KST)에 놓인다
    expect(bucketVisits([mondayMorning, mondayDawn, sundayNight], { unit: "day", ...OPTIONS }).map((b) => b.key)).toEqual(
      ["2026-11-01", "2026-11-02"],
    );
  });

  it("도착 시각이 아니라 예약 시각의 날짜로 나눈다", () => {
    // #19: 예약 10-31 23:50, 도착 11-01 00:20
    expect(bucketVisits([ROWS[18]], { unit: "day", ...OPTIONS })).toEqual([
      { key: "2026-10-31", stats: expected([1, 1, 0, 0, 0, 0, 0, 0], 1, [1, 0, 0, 1]) },
    ]);
  });

  it("유효 예약이 0인 구간도 돌려주되 비율은 null이다", () => {
    const day = bucketVisits(ROWS, { unit: "day", ...OPTIONS }).find((b) => b.key === "2026-10-24");
    expect(day?.stats.booked).toBe(0);
    expect(day?.stats.arrivalRate).toBeNull();
    expect(day?.stats.noShowRate).toBeNull();
    expect(day?.stats.sameDayCancelRate).toBeNull();
    expect(day?.stats.lateRate).toBeNull();
  });

  it("입력 순서가 섞여 있어도 키 오름차순으로 돌려준다", () => {
    const reversed = [...ROWS].reverse();
    for (const unit of ["day", "week", "month"] as const) {
      expect(bucketVisits(reversed, { unit, ...OPTIONS })).toEqual(bucketVisits(ROWS, { unit, ...OPTIONS }));
    }
  });

  it("구간별 건수를 더하면 전체 건수와 같다", () => {
    const total = summarizeVisits(ROWS, OPTIONS);
    for (const unit of ["day", "week", "month"] as const) {
      const buckets = bucketVisits(ROWS, { unit, ...OPTIONS });
      const sum = (pick: (stats: VisitStats) => number) => buckets.reduce((acc, b) => acc + pick(b.stats), 0);
      expect(sum((s) => s.arrived), unit).toBe(total.arrived);
      expect(sum((s) => s.late), unit).toBe(total.late);
      expect(sum((s) => s.noShow), unit).toBe(total.noShow);
      expect(sum((s) => s.sameDayCancel), unit).toBe(total.sameDayCancel);
      expect(sum((s) => s.advanceCancel), unit).toBe(total.advanceCancel);
      expect(sum((s) => s.rescheduled), unit).toBe(total.rescheduled);
      expect(sum((s) => s.unconfirmed), unit).toBe(total.unconfirmed);
      expect(sum((s) => s.upcoming), unit).toBe(total.upcoming);
      expect(sum((s) => s.booked), unit).toBe(total.booked);
    }
  });

  it("빈 입력은 빈 배열이다", () => {
    expect(bucketVisits([], { unit: "day", ...OPTIONS })).toEqual([]);
    expect(bucketVisits([], { unit: "week", ...OPTIONS })).toEqual([]);
    expect(bucketVisits([], { unit: "month", ...OPTIONS })).toEqual([]);
  });
});

describe("bucketKeysInRange", () => {
  it("일: 양 끝을 포함해 하루도 빠짐없이", () => {
    expect(bucketKeysInRange("2026-10-30", "2026-11-02", "day")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
    expect(bucketKeysInRange("2026-11-03", "2026-11-03", "day")).toEqual(["2026-11-03"]);
  });

  it("주: from이 속한 주의 월요일부터 7일 간격 (2026-10-22는 목요일)", () => {
    expect(bucketKeysInRange("2026-10-22", "2026-11-09", "week")).toEqual([
      "2026-10-19",
      "2026-10-26",
      "2026-11-02",
      "2026-11-09",
    ]);
    // 일요일로 끝나면 그 주까지만
    expect(bucketKeysInRange("2026-10-19", "2026-11-08", "week")).toEqual(["2026-10-19", "2026-10-26", "2026-11-02"]);
  });

  it("월: 해를 넘기고, 31일·2월 말에서도 달을 건너뛰지 않는다", () => {
    expect(bucketKeysInRange("2026-11-30", "2027-03-01", "month")).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
      "2027-03",
    ]);
    expect(bucketKeysInRange("2026-01-31", "2026-01-31", "month")).toEqual(["2026-01"]);
  });

  it("최대 기간 366일이면 일 구간 366개", () => {
    const keys = bucketKeysInRange("2025-11-11", "2026-11-11", "day");
    expect(keys).toHaveLength(366);
    expect(keys[0]).toBe("2025-11-11");
    expect(keys.at(-1)).toBe("2026-11-11");
  });

  it("시작일이 종료일보다 늦으면 빈 배열", () => {
    expect(bucketKeysInRange("2026-11-02", "2026-11-01", "day")).toEqual([]);
  });
});

describe("fillBucketGaps", () => {
  it("예약이 없는 날(일요일 등)을 비율 null인 빈 구간으로 채운다", () => {
    const buckets = bucketVisits(ROWS, { unit: "day", ...OPTIONS });
    const filled = fillBucketGaps(buckets, { from: "2026-10-19", to: "2026-11-08" }, "day");
    expect(filled).toHaveLength(21);
    expect(filled.map((b) => b.key)).toEqual(bucketKeysInRange("2026-10-19", "2026-11-08", "day"));
    // 있던 구간은 그대로
    for (const bucket of buckets) expect(filled.find((b) => b.key === bucket.key)).toEqual(bucket);
    // 빈 날(10-21, 일요일 11-08 등)은 모두 0, 비율 null
    const empty = emptyVisitStats();
    expect(filled.find((b) => b.key === "2026-10-21")?.stats).toEqual(empty);
    expect(filled.find((b) => b.key === "2026-11-08")?.stats).toEqual(empty);
    expect(empty.booked).toBe(0);
    expect([empty.arrivalRate, empty.noShowRate, empty.sameDayCancelRate, empty.lateRate]).toEqual([null, null, null, null]);
  });

  it("주·월 단위도 기간 전체를 덮는다", () => {
    const weekly = bucketVisits(ROWS, { unit: "week", ...OPTIONS });
    const weeks = fillBucketGaps(weekly, { from: "2026-10-01", to: "2026-11-11" }, "week");
    expect(weeks.map((b) => b.key)).toEqual([
      "2026-09-28",
      "2026-10-05",
      "2026-10-12",
      "2026-10-19",
      "2026-10-26",
      "2026-11-02",
      "2026-11-09",
    ]);
    expect(weeks[0].stats.arrivalRate).toBeNull();
    const monthly = bucketVisits(ROWS, { unit: "month", ...OPTIONS });
    const months = fillBucketGaps(monthly, { from: "2026-09-15", to: "2026-12-01" }, "month");
    expect(months.map((b) => [b.key, b.stats.booked])).toEqual([
      ["2026-09", 0],
      ["2026-10", 15],
      ["2026-11", 8],
      ["2026-12", 0],
    ]);
  });

  it("예약이 하나도 없으면 전부 빈 구간", () => {
    const filled = fillBucketGaps([], { from: "2026-11-09", to: "2026-11-11" }, "day");
    expect(filled.map((b) => b.key)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11"]);
    expect(filled.every((b) => b.stats.booked === 0 && b.stats.arrivalRate === null)).toBe(true);
  });
});

describe("formatRate", () => {
  it("소수 첫째 자리까지의 백분율로 표시한다", () => {
    expect(formatRate(5 / 6)).toBe("83.3%");
    expect(formatRate(13 / 23)).toBe("56.5%"); // 0.56521…
    expect(formatRate(1 / 8)).toBe("12.5%");
    expect(formatRate(2 / 3)).toBe("66.7%"); // 0.6666… 반올림
  });

  it("0과 1도 소수 첫째 자리까지 표시한다", () => {
    expect(formatRate(0)).toBe("0.0%");
    expect(formatRate(1)).toBe("100.0%");
  });

  it("분모가 0이라 값이 없으면(null) '-'로 표시한다", () => {
    expect(formatRate(null)).toBe("-");
  });
});
