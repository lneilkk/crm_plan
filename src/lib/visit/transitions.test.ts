import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_STATUS_LABEL,
  PENDING_STATUSES,
  type AppointmentStatus,
  type VisitReasonCode,
} from "@/lib/domain/appointment";
import { kstDateTime } from "@/lib/time/kst";
import {
  STATUS_TRANSITIONS,
  availableActions,
  canTransition,
  resolveCancelStatus,
  validateTransition,
  type BoardAction,
  type TransitionErrorCode,
} from "./transitions";

/**
 * 허용되는 전환의 기대값. 구현(STATUS_TRANSITIONS)에서 만들지 않고 여기에 그대로 적는다.
 * 여기에 없는 쌍은 같은 상태로의 전환(X → X)을 포함해 모두 거부되어야 한다.
 */
const EXPECTED: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  BOOKED: ["CONFIRMED", "ARRIVED", "NO_SHOW", "CANCELED_SAME_DAY", "CANCELED_ADVANCE", "RESCHEDULED"],
  CONFIRMED: ["BOOKED", "ARRIVED", "NO_SHOW", "CANCELED_SAME_DAY", "CANCELED_ADVANCE", "RESCHEDULED"],
  ARRIVED: ["BOOKED", "CONFIRMED", "NO_SHOW", "IN_TREATMENT"],
  NO_SHOW: ["BOOKED", "CONFIRMED", "ARRIVED"],
  CANCELED_SAME_DAY: ["BOOKED", "CONFIRMED"],
  CANCELED_ADVANCE: ["BOOKED", "CONFIRMED"],
  RESCHEDULED: [],
  IN_TREATMENT: ["ARRIVED", "PAID"],
  PAID: ["IN_TREATMENT", "LEFT"],
  LEFT: ["PAID"],
};

const ALL_PAIRS = APPOINTMENT_STATUSES.flatMap((from) =>
  APPOINTMENT_STATUSES.map((to) => {
    const allowed = EXPECTED[from]?.includes(to) ?? false;
    return {
      from,
      to,
      allowed,
      fromLabel: APPOINTMENT_STATUS_LABEL[from],
      toLabel: APPOINTMENT_STATUS_LABEL[to],
      verdict: allowed ? "허용" : "거부",
    };
  }),
);

// 예약: 2026-11-11(수) 한국 시간 10:00, 노쇼 유예시간 30분
const startAt = new Date("2026-11-11T01:00:00.000Z");
const GRACE = 30;
/** 노쇼 처리가 가능해지는 시각 = 한국 시간 10:30 */
const graceEnd = new Date("2026-11-11T01:30:00.000Z");
/** 예약일의 한국 시간 00:00 (= UTC 전날 15:00) */
const dayStart = new Date("2026-11-10T15:00:00.000Z");
/** 예약 다음 날의 한국 시간 00:00 */
const nextDayStart = new Date("2026-11-11T15:00:00.000Z");

const REASON: VisitReasonCode = "NO_CONTACT";

function msBefore(instant: Date, ms = 1): Date {
  return new Date(instant.getTime() - ms);
}

function check(
  from: AppointmentStatus,
  to: AppointmentStatus,
  now: Date,
  reasonCode?: VisitReasonCode | null,
  appointmentStartAt: Date = startAt,
) {
  return validateTransition({ from, to, startAt: appointmentStartAt, now, noShowGraceMin: GRACE, reasonCode });
}

function expectRejected(result: ReturnType<typeof validateTransition>, code: TransitionErrorCode) {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.code).toBe(code);
  expect(result.message).toMatch(/[가-힣]/);
}

describe("기대값 표", () => {
  it("모든 상태가 기대값 표에 있다 (상태를 추가하면 표에도 추가해야 한다)", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...APPOINTMENT_STATUSES].sort());
  });

  it("상태는 10개이고 상태 쌍은 100개다", () => {
    expect(APPOINTMENT_STATUSES).toHaveLength(10);
    expect(new Set(APPOINTMENT_STATUSES).size).toBe(10);
    expect(ALL_PAIRS).toHaveLength(100);
    expect(ALL_PAIRS.filter((pair) => pair.allowed)).toHaveLength(28);
  });

  it("기대값 표에는 알려진 상태만 있고, 같은 상태로의 전환과 중복이 없다", () => {
    for (const [from, targets] of Object.entries(EXPECTED)) {
      expect(new Set(targets).size).toBe(targets.length);
      expect(targets).not.toContain(from);
      for (const to of targets) expect(APPOINTMENT_STATUSES).toContain(to);
    }
  });
});

describe("canTransition — 모든 상태 쌍", () => {
  it.each(ALL_PAIRS)("$fromLabel → $toLabel: $verdict", ({ from, to, allowed }) => {
    expect(canTransition(from, to)).toBe(allowed);
  });
});

describe("STATUS_TRANSITIONS", () => {
  it("기대값 표와 같은 전환만 담고 있다", () => {
    expect(Object.keys(STATUS_TRANSITIONS).sort()).toEqual([...APPOINTMENT_STATUSES].sort());
    for (const from of APPOINTMENT_STATUSES) {
      expect([...STATUS_TRANSITIONS[from]].sort()).toEqual([...EXPECTED[from]].sort());
    }
  });
});

describe("validateTransition — 전환 표가 먼저다", () => {
  it.each([
    ["예약일 전날", msBefore(dayStart)],
    ["예약일, 유예시간이 지난 뒤", graceEnd],
    ["예약 다음 날", nextDayStart],
  ])("표에 없는 전환은 %s에도 사유가 있어도 NOT_ALLOWED다", (_label, now) => {
    for (const { from, to, allowed } of ALL_PAIRS) {
      const result = check(from, to, now, REASON);
      const notAllowed = !result.ok && result.code === "NOT_ALLOWED";
      expect(notAllowed, `${from} → ${to}`).toBe(!allowed);
    }
  });

  it("표에 있는 전환은 조건이 맞으면 모두 통과한다", () => {
    for (const { from, to } of ALL_PAIRS.filter((pair) => pair.allowed)) {
      // 사전취소만 예약일 전에, 나머지는 예약일의 유예시간이 지난 뒤에 입력한다
      const now = to === "CANCELED_ADVANCE" ? msBefore(dayStart) : graceEnd;
      expect(check(from, to, now, REASON), `${from} → ${to}`).toEqual({ ok: true });
    }
  });

  it("표에 없는 전환은 사유·시각 검사보다 먼저 거부된다", () => {
    expectRejected(check("LEFT", "NO_SHOW", msBefore(graceEnd)), "NOT_ALLOWED");
    expectRejected(check("RESCHEDULED", "CANCELED_SAME_DAY", msBefore(dayStart)), "NOT_ALLOWED");
    expectRejected(check("PAID", "ARRIVED", msBefore(dayStart)), "NOT_ALLOWED");
  });

  it("같은 상태로의 전환은 거부되고, 메시지에 상태 이름이 들어간다", () => {
    const result = check("ARRIVED", "ARRIVED", graceEnd);
    expectRejected(result, "NOT_ALLOWED");
    if (!result.ok) expect(result.message).toContain("내원");
  });

  it("거부 메시지에 상태 이름이 한국어로 들어간다", () => {
    const result = check("LEFT", "BOOKED", graceEnd);
    expectRejected(result, "NOT_ALLOWED");
    if (!result.ok) {
      expect(result.message).toContain("귀가");
      expect(result.message).toContain("예약확정");
    }
  });
});

describe("validateTransition — 노쇼 (기획서 4-3 규칙 2·3)", () => {
  it("유예시간이 끝나기 1밀리초 전에는 거부한다", () => {
    expectRejected(check("BOOKED", "NO_SHOW", msBefore(graceEnd), REASON), "NO_SHOW_TOO_EARLY");
    expectRejected(check("CONFIRMED", "NO_SHOW", msBefore(graceEnd), REASON), "NO_SHOW_TOO_EARLY");
  });

  it("예약 시각 전과 예약 시각 정각에는 거부한다", () => {
    expectRejected(check("BOOKED", "NO_SHOW", msBefore(dayStart), REASON), "NO_SHOW_TOO_EARLY");
    expectRejected(check("BOOKED", "NO_SHOW", startAt, REASON), "NO_SHOW_TOO_EARLY");
  });

  it("정확히 유예시간이 끝나는 시각에는 허용한다", () => {
    expect(check("BOOKED", "NO_SHOW", graceEnd, REASON)).toEqual({ ok: true });
    expect(check("CONFIRMED", "NO_SHOW", graceEnd, REASON)).toEqual({ ok: true });
  });

  it("유예시간이 지난 뒤와 다음 날에도 허용한다", () => {
    expect(check("BOOKED", "NO_SHOW", new Date(graceEnd.getTime() + 1), REASON)).toEqual({ ok: true });
    expect(check("BOOKED", "NO_SHOW", nextDayStart, REASON)).toEqual({ ok: true });
  });

  it("유예시간 설정을 바꾸면 판정이 바뀐다", () => {
    const now = new Date("2026-11-11T01:10:00.000Z"); // 예약 10분 뒤
    const base = { from: "BOOKED", to: "NO_SHOW", startAt, now, reasonCode: REASON } as const;
    expect(validateTransition({ ...base, noShowGraceMin: 10 })).toEqual({ ok: true });
    expectRejected(validateTransition({ ...base, noShowGraceMin: 11 }), "NO_SHOW_TOO_EARLY");
    expect(validateTransition({ ...base, now: startAt, noShowGraceMin: 0 })).toEqual({ ok: true });
  });

  it("너무 이르다는 메시지에 가능해지는 한국 시각이 들어간다", () => {
    const result = check("BOOKED", "NO_SHOW", startAt, REASON);
    expectRejected(result, "NO_SHOW_TOO_EARLY");
    if (!result.ok) expect(result.message).toContain("10:30");
  });

  it("사유가 없으면 거부한다", () => {
    expectRejected(check("BOOKED", "NO_SHOW", graceEnd), "REASON_REQUIRED");
    expectRejected(check("BOOKED", "NO_SHOW", graceEnd, null), "REASON_REQUIRED");
    expectRejected(check("CONFIRMED", "NO_SHOW", nextDayStart), "REASON_REQUIRED");
  });

  it("목록에 없는 사유 코드는 사유가 없는 것으로 본다", () => {
    expectRejected(check("BOOKED", "NO_SHOW", graceEnd, "" as VisitReasonCode), "REASON_REQUIRED");
    expectRejected(check("BOOKED", "NO_SHOW", graceEnd, "ETC" as VisitReasonCode), "REASON_REQUIRED");
  });

  it.each(["NO_CONTACT", "PERSONAL", "OTHER_CLINIC", "OTHER"] as const)("사유 %s 를 받는다", (reasonCode) => {
    expect(check("BOOKED", "NO_SHOW", graceEnd, reasonCode)).toEqual({ ok: true });
  });

  it("너무 이르고 사유도 없으면 시각 오류가 먼저다", () => {
    expectRejected(check("BOOKED", "NO_SHOW", msBefore(graceEnd)), "NO_SHOW_TOO_EARLY");
  });
});

describe("validateTransition — 당일취소 (기획서 4-1, 4-3 규칙 3)", () => {
  it("예약일 전날 23:59:59.999(한국 시간)에는 거부한다 — 사전취소로 처리해야 한다", () => {
    expectRejected(check("BOOKED", "CANCELED_SAME_DAY", msBefore(dayStart), REASON), "CANCEL_IS_ADVANCE");
    expectRejected(check("CONFIRMED", "CANCELED_SAME_DAY", msBefore(dayStart), REASON), "CANCEL_IS_ADVANCE");
  });

  it("예약일 00:00(한국 시간, UTC 전날 15:00)부터 허용한다", () => {
    expect(check("BOOKED", "CANCELED_SAME_DAY", dayStart, REASON)).toEqual({ ok: true });
    expect(check("CONFIRMED", "CANCELED_SAME_DAY", dayStart, REASON)).toEqual({ ok: true });
  });

  it("예약 시각 전·후 모두 당일이면 허용한다", () => {
    expect(check("BOOKED", "CANCELED_SAME_DAY", msBefore(startAt), REASON)).toEqual({ ok: true });
    expect(check("BOOKED", "CANCELED_SAME_DAY", graceEnd, REASON)).toEqual({ ok: true });
    expect(check("BOOKED", "CANCELED_SAME_DAY", msBefore(nextDayStart), REASON)).toEqual({ ok: true });
  });

  it("다음 날 이후에 뒤늦게 입력하는 것도 허용한다", () => {
    expect(check("BOOKED", "CANCELED_SAME_DAY", nextDayStart, REASON)).toEqual({ ok: true });
    expect(check("BOOKED", "CANCELED_SAME_DAY", new Date("2026-11-20T03:00:00.000Z"), REASON)).toEqual({ ok: true });
  });

  it("사유가 없으면 거부한다", () => {
    expectRejected(check("BOOKED", "CANCELED_SAME_DAY", dayStart), "REASON_REQUIRED");
    expectRejected(check("CONFIRMED", "CANCELED_SAME_DAY", graceEnd, null), "REASON_REQUIRED");
    expectRejected(check("BOOKED", "CANCELED_SAME_DAY", graceEnd, "ETC" as VisitReasonCode), "REASON_REQUIRED");
  });

  it("예약일 전이고 사유도 없으면 취소 구분 오류가 먼저다", () => {
    expectRejected(check("BOOKED", "CANCELED_SAME_DAY", msBefore(dayStart)), "CANCEL_IS_ADVANCE");
  });
});

describe("validateTransition — 사전취소 (기획서 4-1)", () => {
  it("예약일 전날 23:59:59.999(한국 시간)까지 허용하고 사유는 필요 없다", () => {
    expect(check("BOOKED", "CANCELED_ADVANCE", msBefore(dayStart))).toEqual({ ok: true });
    expect(check("CONFIRMED", "CANCELED_ADVANCE", msBefore(dayStart))).toEqual({ ok: true });
    expect(check("BOOKED", "CANCELED_ADVANCE", new Date("2026-11-01T03:00:00.000Z"))).toEqual({ ok: true });
  });

  it("예약일 00:00(한국 시간)부터는 거부한다 — 당일취소로 처리해야 한다", () => {
    expectRejected(check("BOOKED", "CANCELED_ADVANCE", dayStart), "CANCEL_IS_SAME_DAY");
    expectRejected(check("CONFIRMED", "CANCELED_ADVANCE", dayStart), "CANCEL_IS_SAME_DAY");
    expectRejected(check("BOOKED", "CANCELED_ADVANCE", graceEnd), "CANCEL_IS_SAME_DAY");
    expectRejected(check("BOOKED", "CANCELED_ADVANCE", nextDayStart), "CANCEL_IS_SAME_DAY");
  });

  it("사유를 같이 보내도 오류가 아니다", () => {
    expect(check("BOOKED", "CANCELED_ADVANCE", msBefore(dayStart), REASON)).toEqual({ ok: true });
  });
});

describe("validateTransition — 내원", () => {
  it("예약일 전날 23:59:59.999(한국 시간)에는 거부한다", () => {
    expectRejected(check("BOOKED", "ARRIVED", msBefore(dayStart)), "ARRIVAL_BEFORE_APPOINTMENT_DAY");
    expectRejected(check("CONFIRMED", "ARRIVED", msBefore(dayStart)), "ARRIVAL_BEFORE_APPOINTMENT_DAY");
  });

  it("예약일 00:00(한국 시간)부터 허용한다 — 예약 시각보다 일찍 와도 된다", () => {
    expect(check("BOOKED", "ARRIVED", dayStart)).toEqual({ ok: true });
    expect(check("CONFIRMED", "ARRIVED", msBefore(startAt))).toEqual({ ok: true });
  });

  it("예약 시각 이후(지각)와 다음 날 뒤늦은 입력도 허용한다", () => {
    expect(check("BOOKED", "ARRIVED", graceEnd)).toEqual({ ok: true });
    expect(check("BOOKED", "ARRIVED", nextDayStart)).toEqual({ ok: true });
  });

  it("노쇼 처리 뒤 늦게 도착하면 내원으로 바꿀 수 있다", () => {
    expect(check("NO_SHOW", "ARRIVED", graceEnd)).toEqual({ ok: true });
  });

  it("진료중에서 내원으로 되돌릴 때도 같은 날짜 규칙을 적용한다", () => {
    expect(check("IN_TREATMENT", "ARRIVED", graceEnd)).toEqual({ ok: true });
    expectRejected(check("IN_TREATMENT", "ARRIVED", msBefore(dayStart)), "ARRIVAL_BEFORE_APPOINTMENT_DAY");
  });

  it("사유를 같이 보내도 오류가 아니다", () => {
    expect(check("BOOKED", "ARRIVED", graceEnd, REASON)).toEqual({ ok: true });
  });
});

describe("validateTransition — 날짜는 UTC가 아니라 한국 시간으로 비교한다", () => {
  // 한국 시간 11/11 08:00 예약은 UTC로는 11/10 23:00이다. UTC 날짜로 비교하면 틀린다.
  const earlyStartAt = kstDateTime("2026-11-11", "08:00");
  // 한국 시간 11/10 23:00 = UTC 11/10 14:00 → UTC 날짜는 예약과 같지만 한국 날짜는 전날
  const nightBefore = kstDateTime("2026-11-10", "23:00");
  // 한국 시간 11/11 07:00 = UTC 11/10 22:00 → 한국 날짜로 당일
  const sameMorning = kstDateTime("2026-11-11", "07:00");

  it("UTC 날짜가 같아도 한국 날짜가 전날이면 사전취소다", () => {
    expect(earlyStartAt.toISOString()).toBe("2026-11-10T23:00:00.000Z");
    expect(check("BOOKED", "CANCELED_ADVANCE", nightBefore, undefined, earlyStartAt)).toEqual({ ok: true });
    expectRejected(check("BOOKED", "CANCELED_SAME_DAY", nightBefore, REASON, earlyStartAt), "CANCEL_IS_ADVANCE");
    expectRejected(check("BOOKED", "ARRIVED", nightBefore, undefined, earlyStartAt), "ARRIVAL_BEFORE_APPOINTMENT_DAY");
    expect(resolveCancelStatus(earlyStartAt, nightBefore)).toBe("CANCELED_ADVANCE");
  });

  it("한국 날짜로 당일이면 당일취소·내원이 된다", () => {
    expect(check("BOOKED", "CANCELED_SAME_DAY", sameMorning, REASON, earlyStartAt)).toEqual({ ok: true });
    expectRejected(check("BOOKED", "CANCELED_ADVANCE", sameMorning, undefined, earlyStartAt), "CANCEL_IS_SAME_DAY");
    expect(check("BOOKED", "ARRIVED", sameMorning, undefined, earlyStartAt)).toEqual({ ok: true });
    expect(resolveCancelStatus(earlyStartAt, sameMorning)).toBe("CANCELED_SAME_DAY");
  });
});

describe.each(["UTC", "America/New_York", "Pacific/Kiritimati"])(
  "서버 시간대가 %s 여도 날짜 경계는 한국 시간 자정이다",
  (zone) => {
    const original = process.env.TZ;

    beforeAll(() => {
      process.env.TZ = zone;
    });

    afterAll(() => {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    });

    it("시간대 설정이 실제로 적용되었다 (적용되지 않으면 이 묶음은 아무것도 검증하지 못한다)", () => {
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone);
    });

    it("당일취소: 한국 시간 자정 1밀리초 전에는 거부, 자정부터 허용", () => {
      expectRejected(check("BOOKED", "CANCELED_SAME_DAY", msBefore(dayStart), REASON), "CANCEL_IS_ADVANCE");
      expect(check("BOOKED", "CANCELED_SAME_DAY", dayStart, REASON)).toEqual({ ok: true });
    });

    it("사전취소: 한국 시간 자정 1밀리초 전까지 허용, 자정부터 거부", () => {
      expect(check("BOOKED", "CANCELED_ADVANCE", msBefore(dayStart))).toEqual({ ok: true });
      expectRejected(check("BOOKED", "CANCELED_ADVANCE", dayStart), "CANCEL_IS_SAME_DAY");
    });

    it("내원: 한국 시간 자정 1밀리초 전에는 거부, 자정부터 허용", () => {
      expectRejected(check("BOOKED", "ARRIVED", msBefore(dayStart)), "ARRIVAL_BEFORE_APPOINTMENT_DAY");
      expect(check("BOOKED", "ARRIVED", dayStart)).toEqual({ ok: true });
    });

    it("[취소] 자동 구분과 보드 버튼도 같은 경계를 쓴다", () => {
      expect(resolveCancelStatus(startAt, msBefore(dayStart))).toBe("CANCELED_ADVANCE");
      expect(resolveCancelStatus(startAt, dayStart)).toBe("CANCELED_SAME_DAY");
      const at = (now: Date) => availableActions({ status: "BOOKED", startAt, now, noShowGraceMin: GRACE }).actions;
      expect(at(msBefore(dayStart))).not.toContain("ARRIVE");
      expect(at(dayStart)).toContain("ARRIVE");
    });

    it("다음 날 한국 시간 자정 직전에 예약된 건도 같은 경계를 쓴다", () => {
      // 한국 시간 11/11 23:30 예약: 어떤 시간대에서도 예약일은 11/11이다
      const lateStartAt = kstDateTime("2026-11-11", "23:30");
      expect(check("BOOKED", "CANCELED_ADVANCE", msBefore(dayStart), undefined, lateStartAt)).toEqual({ ok: true });
      expectRejected(check("BOOKED", "CANCELED_ADVANCE", dayStart, undefined, lateStartAt), "CANCEL_IS_SAME_DAY");
      expect(check("BOOKED", "ARRIVED", dayStart, undefined, lateStartAt)).toEqual({ ok: true });
    });
  },
);

describe("올바르지 않은 입력값은 통과시키지 않고 던진다", () => {
  const invalidDate = new Date(Number.NaN);
  const base = { from: "BOOKED", to: "NO_SHOW", startAt, now: graceEnd, noShowGraceMin: GRACE, reasonCode: REASON } as const;

  it("기준이 되는 입력은 통과한다", () => {
    expect(validateTransition(base)).toEqual({ ok: true });
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["음수", -600],
    ["undefined (설정 누락)", undefined as unknown as number],
    ["null", null as unknown as number],
    ["문자열", "30" as unknown as number],
  ])("유예시간이 %s 이면 노쇼를 허용하지 않고 RangeError를 던진다", (_label, noShowGraceMin) => {
    // 예약 2시간 전: 검사가 없으면 NaN 비교 때문에 노쇼가 허용된다
    const now = new Date(startAt.getTime() - 2 * 60 * 60_000);
    expect(() => validateTransition({ ...base, now, noShowGraceMin })).toThrow(RangeError);
    expect(() => validateTransition({ ...base, noShowGraceMin })).toThrow(RangeError);
    expect(() => availableActions({ status: "BOOKED", startAt, now, noShowGraceMin })).toThrow(RangeError);
  });

  it.each(["NO_SHOW", "ARRIVED", "CANCELED_SAME_DAY", "CANCELED_ADVANCE", "RESCHEDULED"] as const)(
    "now나 startAt이 Invalid Date면 %s 전환은 RangeError를 던진다",
    (to) => {
      expect(() => validateTransition({ ...base, to, now: invalidDate })).toThrow(RangeError);
      expect(() => validateTransition({ ...base, to, startAt: invalidDate })).toThrow(RangeError);
    },
  );

  it("Date가 아닌 값도 던진다", () => {
    const notDate = "2026-11-11T01:30:00.000Z" as unknown as Date;
    expect(() => validateTransition({ ...base, now: notDate })).toThrow(RangeError);
    expect(() => validateTransition({ ...base, startAt: notDate })).toThrow(RangeError);
  });

  it("표에 없는 전환이어도 입력값 오류가 먼저다", () => {
    expect(() => validateTransition({ ...base, from: "LEFT", now: invalidDate })).toThrow(RangeError);
  });

  it("resolveCancelStatus와 availableActions도 Invalid Date를 던진다", () => {
    expect(() => resolveCancelStatus(startAt, invalidDate)).toThrow(RangeError);
    expect(() => resolveCancelStatus(invalidDate, graceEnd)).toThrow(RangeError);
    for (const status of APPOINTMENT_STATUSES) {
      expect(() => availableActions({ status, startAt, now: invalidDate, noShowGraceMin: GRACE })).toThrow(RangeError);
      expect(() => availableActions({ status, startAt: invalidDate, now: graceEnd, noShowGraceMin: GRACE })).toThrow(
        RangeError,
      );
    }
  });

  it("오류 메시지에 입력값을 담지 않는다", () => {
    expect(() => validateTransition({ ...base, noShowGraceMin: -600 })).toThrow(/^noShowGraceMin 값은 0 이상의 숫자여야 합니다$/);
  });
});

describe("노쇼 → 내원을 되돌리는 경로", () => {
  it("노쇼 행에서 잘못 누른 [내원]은 한 번에 노쇼로 되돌릴 수 있다", () => {
    expect(check("NO_SHOW", "ARRIVED", graceEnd)).toEqual({ ok: true });
    expect(check("ARRIVED", "NO_SHOW", graceEnd, REASON)).toEqual({ ok: true });
  });

  it("되돌릴 때도 노쇼 사유와 유예시간 조건은 그대로다", () => {
    expectRejected(check("ARRIVED", "NO_SHOW", graceEnd), "REASON_REQUIRED");
    expectRejected(check("ARRIVED", "NO_SHOW", msBefore(graceEnd), REASON), "NO_SHOW_TOO_EARLY");
  });
});

describe("validateTransition — 조건이 없는 전환", () => {
  it("예약변경과 확인완료는 언제든 가능하다", () => {
    for (const now of [new Date("2026-10-01T03:00:00.000Z"), dayStart, graceEnd, nextDayStart]) {
      expect(check("BOOKED", "RESCHEDULED", now)).toEqual({ ok: true });
      expect(check("CONFIRMED", "RESCHEDULED", now)).toEqual({ ok: true });
      expect(check("BOOKED", "CONFIRMED", now)).toEqual({ ok: true });
      expect(check("CONFIRMED", "BOOKED", now)).toEqual({ ok: true });
    }
  });

  it("되돌리기는 사유·시각 조건이 없다", () => {
    expect(check("ARRIVED", "BOOKED", graceEnd)).toEqual({ ok: true });
    expect(check("NO_SHOW", "CONFIRMED", graceEnd)).toEqual({ ok: true });
    expect(check("CANCELED_SAME_DAY", "BOOKED", nextDayStart)).toEqual({ ok: true });
    expect(check("CANCELED_ADVANCE", "CONFIRMED", msBefore(dayStart))).toEqual({ ok: true });
    expect(check("PAID", "IN_TREATMENT", graceEnd)).toEqual({ ok: true });
    expect(check("LEFT", "PAID", nextDayStart)).toEqual({ ok: true });
  });

  it("사유가 필요 없는 상태에 사유를 보내도 무시한다", () => {
    expect(check("BOOKED", "CONFIRMED", graceEnd, REASON)).toEqual({ ok: true });
    expect(check("BOOKED", "RESCHEDULED", graceEnd, REASON)).toEqual({ ok: true });
    expect(check("NO_SHOW", "BOOKED", graceEnd, "ETC" as VisitReasonCode)).toEqual({ ok: true });
  });
});

describe("resolveCancelStatus — [취소] 버튼의 자동 구분", () => {
  it("예약일 전날 23:59:59.999(한국 시간)까지는 사전취소", () => {
    expect(resolveCancelStatus(startAt, msBefore(dayStart))).toBe("CANCELED_ADVANCE");
    expect(resolveCancelStatus(startAt, new Date("2026-11-01T03:00:00.000Z"))).toBe("CANCELED_ADVANCE");
  });

  it("예약일 00:00(한국 시간)부터는 당일취소", () => {
    expect(resolveCancelStatus(startAt, dayStart)).toBe("CANCELED_SAME_DAY");
    expect(resolveCancelStatus(startAt, msBefore(startAt))).toBe("CANCELED_SAME_DAY");
    expect(resolveCancelStatus(startAt, graceEnd)).toBe("CANCELED_SAME_DAY");
  });

  it("예약일이 지난 뒤에 입력해도 당일취소", () => {
    expect(resolveCancelStatus(startAt, nextDayStart)).toBe("CANCELED_SAME_DAY");
  });

  it("고른 구분은 항상 validateTransition을 통과한다", () => {
    for (const now of [msBefore(dayStart), dayStart, startAt, graceEnd, nextDayStart]) {
      const to = resolveCancelStatus(startAt, now);
      expect(check("BOOKED", to, now, REASON)).toEqual({ ok: true });
    }
  });
});

describe("availableActions — 내원 보드 버튼", () => {
  function actionsOf(status: AppointmentStatus, now: Date) {
    return availableActions({ status, startAt, now, noShowGraceMin: GRACE });
  }

  describe.each(PENDING_STATUSES)("%s (아직 결과가 없는 예약)", (status) => {
    it("예약일 전에는 [취소] [변경]만 가능하다", () => {
      expect(actionsOf(status, msBefore(dayStart))).toEqual({
        actions: ["CANCEL", "RESCHEDULE"],
        noShowAllowedAt: graceEnd,
      });
    });

    it("당일 유예시간 전에는 [노쇼]가 빠지고, 가능해지는 시각을 알려준다", () => {
      const expected = { actions: ["ARRIVE", "CANCEL", "RESCHEDULE"], noShowAllowedAt: graceEnd };
      expect(actionsOf(status, dayStart)).toEqual(expected);
      expect(actionsOf(status, startAt)).toEqual(expected);
      expect(actionsOf(status, msBefore(graceEnd))).toEqual(expected);
    });

    it("정확히 유예시간이 끝나는 시각부터 [노쇼]가 가능하다", () => {
      const expected = { actions: ["ARRIVE", "NO_SHOW", "CANCEL", "RESCHEDULE"], noShowAllowedAt: null };
      expect(actionsOf(status, graceEnd)).toEqual(expected);
      expect(actionsOf(status, nextDayStart)).toEqual(expected);
    });
  });

  /** 결과가 입력된 상태에서 가능한 버튼 (예약일, 유예시간이 지난 뒤 기준) */
  const OUTCOME_ACTIONS: [AppointmentStatus, BoardAction[]][] = [
    ["ARRIVED", ["REVERT"]],
    ["NO_SHOW", ["ARRIVE", "REVERT"]],
    ["CANCELED_SAME_DAY", ["REVERT"]],
    ["CANCELED_ADVANCE", ["REVERT"]],
    ["RESCHEDULED", []],
    ["IN_TREATMENT", ["REVERT"]],
    ["PAID", ["REVERT"]],
    ["LEFT", ["REVERT"]],
  ];

  it.each(OUTCOME_ACTIONS)("%s 상태에서 가능한 버튼: %j", (status, actions) => {
    expect(actionsOf(status, graceEnd)).toEqual({ actions, noShowAllowedAt: null });
  });

  it("버튼 기대값은 모든 상태를 다룬다 (상태를 추가하면 여기에도 추가해야 한다)", () => {
    const covered = [...PENDING_STATUSES, ...OUTCOME_ACTIONS.map(([status]) => status)];
    expect(covered.sort()).toEqual([...APPOINTMENT_STATUSES].sort());
  });

  it("노쇼로 갈 수 없는 상태에는 유예시간 전이어도 noShowAllowedAt이 없다", () => {
    for (const status of APPOINTMENT_STATUSES) {
      if ((PENDING_STATUSES as readonly AppointmentStatus[]).includes(status)) continue;
      expect(actionsOf(status, startAt).noShowAllowedAt, status).toBeNull();
    }
  });

  it("사전취소된 예약은 예약일 전에는 [되돌리기]만 가능하다", () => {
    expect(actionsOf("CANCELED_ADVANCE", msBefore(dayStart))).toEqual({ actions: ["REVERT"], noShowAllowedAt: null });
  });

  it("유예시간 설정을 따른다", () => {
    const result = availableActions({ status: "BOOKED", startAt, now: startAt, noShowGraceMin: 0 });
    expect(result.actions).toContain("NO_SHOW");
    expect(result.noShowAllowedAt).toBeNull();
  });

  it("가능하다고 한 버튼은 validateTransition을 통과하고, 아니라고 한 버튼은 통과하지 못한다", () => {
    for (const status of APPOINTMENT_STATUSES) {
      for (const now of [msBefore(dayStart), dayStart, startAt, msBefore(graceEnd), graceEnd, nextDayStart]) {
        const { actions } = actionsOf(status, now);
        const targets: [BoardAction, AppointmentStatus][] = [
          ["ARRIVE", "ARRIVED"],
          ["NO_SHOW", "NO_SHOW"],
          ["CANCEL", resolveCancelStatus(startAt, now)],
          ["RESCHEDULE", "RESCHEDULED"],
        ];
        for (const [action, to] of targets) {
          const label = `${status} ${action} @ ${now.toISOString()}`;
          // 진료중 → 내원, 내원 → 노쇼는 버튼이 아니라 되돌리기다
          const isRevert =
            (status === "IN_TREATMENT" && action === "ARRIVE") || (status === "ARRIVED" && action === "NO_SHOW");
          expect(actions.includes(action), label).toBe(check(status, to, now, REASON).ok && !isRevert);
        }
      }
    }
  });

  it("[되돌리기]가 가능한 상태는 바로 앞 단계나 대기 상태로 돌아가는 전환이 있다", () => {
    const previous: Partial<Record<AppointmentStatus, AppointmentStatus>> = {
      ARRIVED: "BOOKED",
      NO_SHOW: "BOOKED",
      CANCELED_SAME_DAY: "BOOKED",
      CANCELED_ADVANCE: "BOOKED",
      IN_TREATMENT: "ARRIVED",
      PAID: "IN_TREATMENT",
      LEFT: "PAID",
    };
    for (const status of APPOINTMENT_STATUSES) {
      const canRevert = actionsOf(status, graceEnd).actions.includes("REVERT");
      const back = previous[status];
      expect(canRevert, status).toBe(back !== undefined);
      if (back) expect(canTransition(status, back), status).toBe(true);
    }
  });
});

describe("전환 표의 도달 가능성", () => {
  function reachableFrom(start: AppointmentStatus): Set<AppointmentStatus> {
    const seen = new Set<AppointmentStatus>([start]);
    const queue: AppointmentStatus[] = [start];
    for (let from = queue.shift(); from !== undefined; from = queue.shift()) {
      for (const to of APPOINTMENT_STATUSES) {
        if (canTransition(from, to) && !seen.has(to)) {
          seen.add(to);
          queue.push(to);
        }
      }
    }
    return seen;
  }

  it("예약확정에서 모든 상태에 도달할 수 있다", () => {
    expect([...reachableFrom("BOOKED")].sort()).toEqual([...APPOINTMENT_STATUSES].sort());
  });

  it("예약변경에서는 나갈 수 없다 (연결된 새 예약이 이어받는다)", () => {
    expect(STATUS_TRANSITIONS.RESCHEDULED).toEqual([]);
    expect([...reachableFrom("RESCHEDULED")]).toEqual(["RESCHEDULED"]);
  });

  it.each(APPOINTMENT_STATUSES.filter((status) => status !== "RESCHEDULED"))(
    "%s 에서 대기 상태(예약확정·확인완료)로 돌아갈 수 있다",
    (status) => {
      const reachable = reachableFrom(status);
      expect(reachable.has("BOOKED")).toBe(true);
      expect(reachable.has("CONFIRMED")).toBe(true);
    },
  );
});
