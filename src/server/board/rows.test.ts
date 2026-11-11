import { describe, expect, it } from "vitest";
import type { AppointmentStatus } from "@/lib/domain/appointment";
import { kstDateTime } from "@/lib/time/kst";
import { availableActions } from "@/lib/visit/transitions";
import { type BoardSource, buildBoard, overdueOf, summarize, toBoardRow } from "./rows";

const DAY = "2026-11-11";
const SETTINGS = { lateToleranceMin: 15, noShowGraceMin: 30 };
const at = (time: string) => kstDateTime(DAY, time);

let seq = 0;
function source(overrides: Partial<BoardSource> = {}): BoardSource {
  seq += 1;
  return {
    id: `00000000-0000-7000-8000-${String(seq).padStart(12, "0")}`,
    patientId: `p-${seq}`,
    nameMasked: "가*자",
    startAt: at("10:00"),
    durationMin: 30,
    chair: "C1",
    status: "BOOKED",
    arrivedAt: null,
    treatmentItem: "정기검진",
    channel: "PHONE",
    doctorName: null,
    counselorName: null,
    referralSource: null,
    isNew: false,
    ...overrides,
  };
}

describe("overdueOf — 미확인 강조", () => {
  it("예약 시각 전이면 없음, 지나면 주황, 유예시간이 지나면 빨강", () => {
    const start = at("10:00");
    expect(overdueOf("BOOKED", start, at("09:59"), 30)).toBe("none");
    expect(overdueOf("BOOKED", start, at("10:00"), 30)).toBe("orange");
    expect(overdueOf("CONFIRMED", start, at("10:29"), 30)).toBe("orange");
    expect(overdueOf("BOOKED", start, at("10:30"), 30)).toBe("red");
  });

  it("결과가 입력된 예약은 강조하지 않는다", () => {
    for (const status of ["ARRIVED", "NO_SHOW", "CANCELED_SAME_DAY", "IN_TREATMENT"] as AppointmentStatus[]) {
      expect(overdueOf(status, at("10:00"), at("12:00"), 30)).toBe("none");
    }
  });
});

describe("toBoardRow", () => {
  it("지각내원은 허용시간을 넘겨 내원한 경우에만 자동 표시한다", () => {
    const onTime = toBoardRow(source({ status: "ARRIVED", arrivedAt: at("10:15") }), SETTINGS, at("11:00"));
    expect(onTime).toMatchObject({ isLate: false, statusLabel: "내원" });
    const late = toBoardRow(source({ status: "ARRIVED", arrivedAt: at("10:16") }), SETTINGS, at("11:00"));
    expect(late).toMatchObject({ isLate: true, statusLabel: "지각내원" });
    // 진료중으로 넘어가도 지각 여부는 남고, 상태 이름은 진료중
    const inTreatment = toBoardRow(source({ status: "IN_TREATMENT", arrivedAt: at("10:20") }), SETTINGS, at("11:00"));
    expect(inTreatment).toMatchObject({ isLate: true, statusLabel: "진료중" });
  });

  it("지각 허용시간 설정을 따른다", () => {
    const row = source({ status: "ARRIVED", arrivedAt: at("10:06") });
    expect(toBoardRow(row, { ...SETTINGS, lateToleranceMin: 5 }, at("11:00")).isLate).toBe(true);
    expect(toBoardRow(row, { ...SETTINGS, lateToleranceMin: 10 }, at("11:00")).isLate).toBe(false);
  });

  it("버튼·노쇼 가능 시각은 availableActions와 같다", () => {
    const now = at("10:10");
    for (const status of ["BOOKED", "CONFIRMED", "ARRIVED", "NO_SHOW", "CANCELED_SAME_DAY"] as AppointmentStatus[]) {
      const row = toBoardRow(source({ status, arrivedAt: status === "ARRIVED" ? at("10:05") : null }), SETTINGS, now);
      const expected = availableActions({ status, startAt: at("10:00"), now, noShowGraceMin: 30 });
      expect(row.actions).toEqual(expected.actions);
      expect(row.noShowAllowedAt).toBe(expected.noShowAllowedAt?.toISOString() ?? null);
    }
  });

  it("[노쇼]는 유예시간 전에는 없고 가능 시각을 알려 준다", () => {
    const early = toBoardRow(source(), SETTINGS, at("10:20"));
    expect(early.actions).not.toContain("NO_SHOW");
    expect(early.noShowAllowedAt).toBe(at("10:30").toISOString());
    const later = toBoardRow(source(), SETTINGS, at("10:30"));
    expect(later.actions).toContain("NO_SHOW");
    expect(later.noShowAllowedAt).toBeNull();
  });

  it("[취소]는 예약일 전이면 사전취소, 당일이면 당일취소", () => {
    expect(toBoardRow(source(), SETTINGS, kstDateTime("2026-11-10", "23:59")).cancelTo).toBe("CANCELED_ADVANCE");
    expect(toBoardRow(source(), SETTINGS, kstDateTime(DAY, "00:00")).cancelTo).toBe("CANCELED_SAME_DAY");
  });

  it("시각은 한국 시간 HH:mm, ISO 문자열로 보낸다", () => {
    const row = toBoardRow(source({ startAt: at("09:30") }), SETTINGS, at("08:00"));
    expect(row.time).toBe("09:30");
    expect(row.startAt).toBe("2026-11-11T00:30:00.000Z");
  });
});

describe("buildBoard", () => {
  it("시각순으로 정렬하고 예약변경된 원 예약은 뺀다", () => {
    const sources = [
      source({ startAt: at("11:00"), chair: "C2" }),
      source({ startAt: at("09:30") }),
      source({ startAt: at("11:00"), chair: "C1" }),
      source({ startAt: at("10:00"), status: "RESCHEDULED" }),
    ];
    const { items } = buildBoard(sources, SETTINGS, at("08:00"));
    expect(items.map((row) => `${row.time} ${row.chair}`)).toEqual(["09:30 C1", "11:00 C1", "11:00 C2"]);
  });
});

describe("summarize — 상단 요약", () => {
  it("예약·내원·대기·노쇼·미확인·당일취소·지각을 센다 (사전취소는 예약 수에서 뺀다)", () => {
    const now = at("12:00");
    const rows = [
      source({ startAt: at("09:30"), status: "ARRIVED", arrivedAt: at("09:30") }),
      source({ startAt: at("10:00"), status: "ARRIVED", arrivedAt: at("10:40") }), // 지각
      source({ startAt: at("10:30"), status: "PAID", arrivedAt: at("10:30") }),
      source({ startAt: at("11:00"), status: "NO_SHOW" }),
      source({ startAt: at("11:30"), status: "BOOKED" }), // 미확인
      source({ startAt: at("12:00"), status: "CONFIRMED" }), // 미확인 (같은 시각)
      source({ startAt: at("13:00"), status: "BOOKED" }), // 대기
      source({ startAt: at("14:00"), status: "CANCELED_SAME_DAY" }),
      source({ startAt: at("15:00"), status: "CANCELED_ADVANCE" }),
    ].map((s) => toBoardRow(s, SETTINGS, now));
    expect(summarize(rows, now)).toEqual({
      total: 8,
      arrived: 3,
      waiting: 1,
      noShow: 1,
      unconfirmed: 2,
      sameDayCanceled: 1,
      late: 1,
    });
  });
});
