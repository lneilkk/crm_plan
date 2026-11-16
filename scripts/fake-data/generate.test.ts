import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APPOINTMENT_CHANNELS,
  PENDING_STATUSES,
  REASON_REQUIRED_STATUSES,
  SLOT_HOLDING_STATUSES,
  VISIT_REASON_CODES,
  type AppointmentStatus,
} from "@/lib/domain/appointment";
import { DEFAULT_CLINIC_SETTINGS, type BusinessHours, type ClinicSettings } from "@/lib/domain/clinic";
import { GENDERS, REFERRAL_SOURCES } from "@/lib/domain/patient";
import { normalizePhone } from "@/lib/phone";
import { addDays, isValidDateKey, kstDateKey, kstDateTime, kstMinutesOfDay, kstWeekday } from "@/lib/time/kst";
import { isLateArrival, noShowAllowedFrom } from "@/lib/visit/lateness";
import {
  FAKE_DATA_TAG,
  FAKE_INPUT_DEVICE,
  generateFakeData,
  type FakeAppointment,
  type FakeData,
  type FakeStatusLog,
} from "./generate";

const MINUTE_MS = 60_000;
const NOW = new Date("2026-11-11T05:00:00.000Z"); // KST 2026-11-11(수) 14:00 — 진료 시간 한가운데
const NOW_MS = NOW.getTime();
const TODAY = kstDateKey(NOW);
const settings = DEFAULT_CLINIC_SETTINGS;

/** 어느 seed에서나 지켜져야 하는 규칙은 seed 여러 개로 확인한다 */
const SEEDS = [1, 7, 20261111];
const runs: FakeData[] = SEEDS.map((seed) => generateFakeData({ seed, now: NOW }));
const data = runs[0];

/*
 * 예약·이력은 수천 건이라 건마다 expect를 부르지 않고, 규칙을 어긴 항목만 모아 빈 배열인지 본다.
 * 실패하면 어긴 항목이 그대로 출력된다.
 */

function hoursOf(dateKey: string, businessHours: BusinessHours = settings.businessHours) {
  return businessHours[String(kstWeekday(dateKey)) as keyof BusinessHours];
}

function endMs(appointment: FakeAppointment): number {
  return appointment.startAt.getTime() + appointment.durationMin * MINUTE_MS;
}

function isOneOf(statuses: readonly AppointmentStatus[], status: AppointmentStatus): boolean {
  return statuses.includes(status);
}

function isPending(appointment: FakeAppointment): boolean {
  return isOneOf(PENDING_STATUSES, appointment.status);
}

/** 진료일의 진료시간 안에 있는지 */
function isInsideBusinessHours(appointment: FakeAppointment, businessHours: BusinessHours): boolean {
  const dateKey = kstDateKey(appointment.startAt);
  const hours = hoursOf(dateKey, businessHours);
  if (!hours) return false;
  return (
    appointment.startAt.getTime() >= kstDateTime(dateKey, hours.open).getTime() &&
    endMs(appointment) <= kstDateTime(dateKey, hours.close).getTime()
  );
}

/** 예약 key → 그 예약의 이력 (생성기가 준 순서 그대로) */
function groupLogs(logs: FakeStatusLog[]): Map<number, FakeStatusLog[]> {
  const grouped = new Map<number, FakeStatusLog[]>();
  for (const log of logs) {
    const list = grouped.get(log.appointmentKey);
    if (list) list.push(log);
    else grouped.set(log.appointmentKey, [log]);
  }
  return grouped;
}

function share<T>(items: T[], predicate: (item: T) => boolean): number {
  return items.filter(predicate).length / items.length;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("재현성", () => {
  it("seed와 now가 같으면 결과가 완전히 같다", () => {
    expect(generateFakeData({ seed: 1, now: NOW })).toEqual(data);
  });

  it("seed가 다르면 이름과 전화번호가 달라진다", () => {
    const other = runs[1];
    expect(other.patients.map((p) => p.name)).not.toEqual(data.patients.map((p) => p.name));
    const phones = new Set(data.patients.map((p) => p.phone));
    expect(other.patients.filter((p) => phones.has(p.phone)).length).toBeLessThan(5);
  });

  it("Math.random과 Date.now를 쓰지 않는다", () => {
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random 사용 금지");
    });
    vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("Date.now 사용 금지");
    });
    expect(generateFakeData({ seed: 1, now: NOW })).toEqual(data);
  });
});

describe("환자", () => {
  it("기본 500명, patientCount로 바꿀 수 있다", () => {
    expect(data.patients).toHaveLength(500);
    expect(generateFakeData({ seed: 1, now: NOW, patientCount: 30 }).patients).toHaveLength(30);
  });

  it("key는 배열 순번이다", () => {
    expect(data.patients.map((p) => p.key)).toEqual(data.patients.map((_, index) => index));
  });

  it("전화번호는 모두 배정되지 않는 대역(010-0XXX-XXXX)이다", () => {
    for (const run of runs) {
      expect(run.patients.filter((p) => !/^0100\d{7}$/.test(p.phone))).toEqual([]);
      expect(run.patients.filter((p) => normalizePhone(p.phone) !== p.phone)).toEqual([]);
    }
  });

  it("약 2%만 다른 환자와 번호를 같이 쓴다(가족)", () => {
    for (const run of runs) {
      const shared = run.patients.length - new Set(run.patients.map((p) => p.phone)).size;
      expect(shared).toBeGreaterThanOrEqual(1);
      expect(shared).toBeLessThanOrEqual(25);
    }
  });

  it("이름은 한글 세 글자 조합이다", () => {
    expect(data.patients.filter((p) => !/^[가-힣]{3}$/.test(p.name))).toEqual([]);
    expect(new Set(data.patients.map((p) => p.name)).size).toBeGreaterThan(400);
  });

  it("차트번호는 가짜 형식이고 겹치지 않으며 약 80%가 갖는다", () => {
    for (const run of runs) {
      const chartNos = run.patients.flatMap((p) => (p.dentwebChartNo === null ? [] : [p.dentwebChartNo]));
      expect(chartNos.filter((chartNo) => !/^F\d{6}$/.test(chartNo))).toEqual([]);
      expect(new Set(chartNos).size).toBe(chartNos.length);
      expect(chartNos.length / run.patients.length).toBeGreaterThan(0.7);
      expect(chartNos.length / run.patients.length).toBeLessThan(0.9);
    }
  });

  it("모든 환자에 '가짜데이터' 태그가 있고, 일부는 태그가 한두 개 더 있다", () => {
    expect(data.patients.filter((p) => !p.tags.includes(FAKE_DATA_TAG))).toEqual([]);
    expect(data.patients.filter((p) => p.tags.length > 3 || new Set(p.tags).size !== p.tags.length)).toEqual([]);
    expect(data.patients.some((p) => p.tags.length > 1)).toBe(true);
    expect(FAKE_DATA_TAG).toBe("가짜데이터");
  });

  it("생년월일은 실제 날짜이고 나이는 대략 5~85세다", () => {
    const youngest = addDays(TODAY, -5 * 365);
    const oldest = addDays(TODAY, -86 * 366);
    expect(
      data.patients.filter((p) => !isValidDateKey(p.birthDate) || p.birthDate > youngest || p.birthDate < oldest),
    ).toEqual([]);
  });

  it("성별·유입경로는 도메인 값이고 메모는 대부분 비어 있다", () => {
    expect(
      data.patients.filter((p) => !GENDERS.includes(p.gender) || !REFERRAL_SOURCES.includes(p.referralSource)),
    ).toEqual([]);
    expect(new Set(data.patients.map((p) => p.gender)).size).toBe(2);
    expect(new Set(data.patients.map((p) => p.referralSource)).size).toBe(REFERRAL_SOURCES.length);
    expect(share(data.patients, (p) => p.memo === null)).toBeGreaterThan(0.8);
    expect(data.patients.some((p) => p.memo !== null)).toBe(true);
  });

  it("주민등록번호·진료기록 같은 필드가 없다 (절대 규칙 3)", () => {
    const allowed = [
      "birthDate",
      "dentwebChartNo",
      "gender",
      "key",
      "memo",
      "name",
      "noShowCount",
      "phone",
      "referralSource",
      "tags",
      "visitType",
    ];
    expect(data.patients.filter((p) => Object.keys(p).sort().join() !== allowed.join())).toEqual([]);
  });

  it("신규는 생성 범위 안에 첫 예약이 있는 환자다", () => {
    for (const run of runs) {
      const withAppointment = new Set(run.appointments.map((a) => a.patientKey));
      const newPatients = run.patients.filter((p) => p.visitType === "NEW");
      expect(newPatients.filter((p) => !withAppointment.has(p.key))).toEqual([]);
      expect(newPatients.length).toBeGreaterThan(50);
      expect(run.patients.length - newPatients.length).toBeGreaterThan(200);
    }
  });
});

describe("예약", () => {
  it("key는 배열 순번이고 환자·의사·항목·채널·체어가 모두 유효하다", () => {
    const chairCodes = settings.chairs.map((c) => c.code);
    for (const run of runs) {
      const invalid = run.appointments.filter(
        (a, index) =>
          a.key !== index ||
          run.patients[a.patientKey]?.key !== a.patientKey ||
          !["doctor1", "doctor2"].includes(a.doctorKey) ||
          !settings.treatmentItems.includes(a.treatmentItem) ||
          !APPOINTMENT_CHANNELS.includes(a.channel) ||
          !chairCodes.includes(a.chairCode),
      );
      expect(invalid).toEqual([]);
    }
  });

  it("진료일의 진료시간 안에만 있고, 30분 단위로 시작하며 30·60·90분 동안 한다", () => {
    for (const run of runs) {
      const invalid = run.appointments.filter(
        (a) =>
          !isInsideBusinessHours(a, settings.businessHours) ||
          kstMinutesOfDay(a.startAt) % 30 !== 0 ||
          ![30, 60, 90].includes(a.durationMin),
      );
      expect(invalid).toEqual([]);
      expect(new Set(run.appointments.map((a) => a.durationMin)).size).toBe(3);
    }
  });

  it("상담실은 '상담' 항목만 쓰고, 상담은 상담실에서만 한다", () => {
    const consultRooms = settings.chairs.filter((c) => c.kind === "CONSULT_ROOM").map((c) => c.code);
    for (const run of runs) {
      const invalid = run.appointments.filter(
        (a) => consultRooms.includes(a.chairCode) !== (a.treatmentItem === "상담"),
      );
      expect(invalid).toEqual([]);
      expect(run.appointments.some((a) => a.treatmentItem === "상담")).toBe(true);
    }
  });

  it("항목 비율이 실제 치과에 가깝다: 정기검진·스케일링·충치 치료가 임플란트·교정보다 훨씬 많다", () => {
    for (const run of runs) {
      const count = (item: string) => run.appointments.filter((a) => a.treatmentItem === item).length;
      const common = count("정기검진") + count("스케일링") + count("충치 치료");
      expect(common / run.appointments.length).toBeGreaterThan(0.5);
      for (const rare of ["임플란트", "교정", "미백"]) {
        expect(count("정기검진")).toBeGreaterThan(3 * count(rare));
        expect(count("스케일링")).toBeGreaterThan(3 * count(rare));
      }
      // 모든 항목이 적어도 몇 건은 나온다 (항목별 통계가 비지 않게)
      for (const item of settings.treatmentItems) expect(count(item)).toBeGreaterThan(5);
    }
  });

  it("소요시간은 항목에 맞는다: 정기검진·상담은 대부분 30분, 임플란트는 30분이 없다", () => {
    for (const run of runs) {
      const byItem = (item: string) => run.appointments.filter((a) => a.treatmentItem === item);
      for (const item of ["정기검진", "상담"]) {
        expect(share(byItem(item), (a) => a.durationMin === 30)).toBeGreaterThan(0.6);
        expect(byItem(item).filter((a) => a.durationMin === 90)).toEqual([]);
      }
      expect(byItem("임플란트").filter((a) => a.durationMin === 30)).toEqual([]);
    }
  });

  it("같은 체어에서 시간이 겹치지 않는다 (DB 제약: 자리를 차지하는 상태끼리 [start, end) 겹침 금지)", () => {
    const overlaps = (list: FakeAppointment[]): FakeAppointment[][] => {
      const byChair = new Map<string, FakeAppointment[]>();
      for (const appointment of list) {
        byChair.set(appointment.chairCode, [...(byChair.get(appointment.chairCode) ?? []), appointment]);
      }
      const found: FakeAppointment[][] = [];
      for (const sameChair of byChair.values()) {
        sameChair.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
        for (let i = 1; i < sameChair.length; i++) {
          // 앞 예약이 끝나는 시각에 다음 예약이 시작하는 것은 겹침이 아니다
          if (sameChair[i].startAt.getTime() < endMs(sameChair[i - 1])) found.push([sameChair[i - 1], sameChair[i]]);
        }
      }
      return found;
    };
    for (const run of runs) {
      expect(overlaps(run.appointments.filter((a) => isOneOf(SLOT_HOLDING_STATUSES, a.status)))).toEqual([]);
      // 생성기는 더 엄격하다: 노쇼·취소된 예약도 등록 당시에는 자리를 차지했으므로 다른 예약과 겹치지 않는다
      expect(overlaps(run.appointments)).toEqual([]);
    }
  });

  it("날짜 범위는 오늘 기준 약 2개월 전 ~ 1개월 뒤다", () => {
    for (const run of runs) {
      const dateKeys = run.appointments.map((a) => kstDateKey(a.startAt)).sort();
      const first = dateKeys[0];
      const last = dateKeys[dateKeys.length - 1];
      expect(first >= addDays(TODAY, -60) && first <= addDays(TODAY, -57), first).toBe(true);
      expect(last <= addDays(TODAY, 30) && last >= addDays(TODAY, 27), last).toBe(true);
    }
  });

  it("평일은 하루 25~45건, 반일 진료일(토)은 그에 비례해 적고, 휴진일에는 없다", () => {
    for (const run of runs) {
      const perDay = new Map<string, number>();
      for (const appointment of run.appointments) {
        const dateKey = kstDateKey(appointment.startAt);
        perDay.set(dateKey, (perDay.get(dateKey) ?? 0) + 1);
      }
      const outOfRange: string[] = [];
      for (let dateKey = addDays(TODAY, -60); dateKey <= addDays(TODAY, 30); dateKey = addDays(dateKey, 1)) {
        const count = perDay.get(dateKey) ?? 0;
        const weekday = kstWeekday(dateKey);
        const [min, max] = weekday === 0 ? [0, 0] : weekday === 6 ? [10, 25] : [25, 45];
        if (count < min || count > max) outOfRange.push(`${dateKey}: ${count}건`);
      }
      expect(outOfRange).toEqual([]);
    }
  });

  it("지난 날의 상태 비율: 내원 약 82%, 노쇼 7%, 당일취소 5%, 사전취소 3%, 변경 3%", () => {
    for (const run of runs) {
      const past = run.appointments.filter((a) => kstDateKey(a.startAt) < TODAY);
      expect(past.length).toBeGreaterThan(1000);
      const rate = (status: AppointmentStatus) => share(past, (a) => a.status === status);
      expect(rate("ARRIVED")).toBeGreaterThan(0.78);
      expect(rate("ARRIVED")).toBeLessThan(0.86);
      expect(rate("NO_SHOW")).toBeGreaterThan(0.05);
      expect(rate("NO_SHOW")).toBeLessThan(0.1);
      expect(rate("CANCELED_SAME_DAY")).toBeGreaterThan(0.03);
      expect(rate("CANCELED_SAME_DAY")).toBeLessThan(0.07);
      expect(rate("CANCELED_ADVANCE")).toBeGreaterThan(0.015);
      expect(rate("CANCELED_ADVANCE")).toBeLessThan(0.05);
      expect(rate("RESCHEDULED")).toBeGreaterThan(0.015);
      expect(rate("RESCHEDULED")).toBeLessThan(0.05);
      // 지난 날에 결과가 안 정해진 예약은 없다
      expect(past.filter(isPending)).toEqual([]);
    }
  });

  it("오늘: 지금 이전은 대부분 내원이고 몇 건은 미확인, 지금 이후는 예약확정·확인완료", () => {
    for (const run of runs) {
      const today = run.appointments.filter((a) => kstDateKey(a.startAt) === TODAY);
      const before = today.filter((a) => a.startAt.getTime() <= NOW_MS);
      const after = today.filter((a) => a.startAt.getTime() > NOW_MS);
      expect(before.length).toBeGreaterThan(5);
      expect(after.length).toBeGreaterThan(5);
      expect(before.filter((a) => a.status !== "ARRIVED" && !isPending(a))).toEqual([]);
      // 오늘 지나간 예약은 스무 건 안팎이라 비율이 크게 흔들린다. '절반 넘게 내원'만 확인한다.
      expect(share(before, (a) => a.status === "ARRIVED")).toBeGreaterThan(0.5);
      expect(before.some(isPending)).toBe(true);
      expect(after.filter((a) => !isPending(a))).toEqual([]);
    }
  });

  it("앞으로의 예약은 예약확정(약 70%) 또는 확인완료다", () => {
    for (const run of runs) {
      const future = run.appointments.filter((a) => kstDateKey(a.startAt) > TODAY);
      expect(future.length).toBeGreaterThan(500);
      expect(future.filter((a) => !isPending(a))).toEqual([]);
      expect(share(future, (a) => a.status === "BOOKED")).toBeGreaterThan(0.64);
      expect(share(future, (a) => a.status === "BOOKED")).toBeLessThan(0.76);
    }
  });

  it("노쇼·당일취소에는 반드시 사유가 있고, 다른 상태에는 없다 (기획서 4-3 규칙 3)", () => {
    for (const run of runs) {
      const invalid = run.appointments.filter((a) =>
        isOneOf(REASON_REQUIRED_STATUSES, a.status)
          ? a.reasonCode === null || !VISIT_REASON_CODES.includes(a.reasonCode)
          : a.reasonCode !== null,
      );
      expect(invalid).toEqual([]);
      expect(run.appointments.some((a) => a.status === "NO_SHOW")).toBe(true);
      expect(run.appointments.some((a) => a.status === "CANCELED_SAME_DAY")).toBe(true);
    }
  });

  it("내원한 예약에만 내원 시각이 있고, 예약 시각 15분 전 ~ 45분 후이며, 지각은 대략 10~15%다", () => {
    for (const run of runs) {
      expect(run.appointments.filter((a) => (a.arrivedAt !== null) !== (a.status === "ARRIVED"))).toEqual([]);

      const arrivals = run.appointments.flatMap((a) => (a.arrivedAt ? [{ a, arrivedAt: a.arrivedAt }] : []));
      const offsetMin = (startAt: Date, arrivedAt: Date) => (arrivedAt.getTime() - startAt.getTime()) / MINUTE_MS;
      expect(
        arrivals.filter(({ a, arrivedAt }) => offsetMin(a.startAt, arrivedAt) < -15 || offsetMin(a.startAt, arrivedAt) > 45),
      ).toEqual([]);

      const lateRate = share(arrivals, ({ a, arrivedAt }) =>
        isLateArrival(a.startAt, arrivedAt, settings.lateToleranceMin),
      );
      expect(lateRate).toBeGreaterThan(0.08);
      expect(lateRate).toBeLessThan(0.17);
    }
  });

  it("워크인은 내원한 예약에만 있다", () => {
    for (const run of runs) {
      const walkIns = run.appointments.filter((a) => a.channel === "WALK_IN");
      expect(walkIns.length).toBeGreaterThan(0);
      expect(walkIns.filter((a) => a.status !== "ARRIVED" || a.originalKey !== null)).toEqual([]);
    }
  });

  it("예약변경된 예약마다 더 늦은 시각의 새 예약 하나가 원 예약을 가리킨다", () => {
    for (const run of runs) {
      const rescheduled = run.appointments.filter((a) => a.status === "RESCHEDULED");
      expect(rescheduled.length).toBeGreaterThan(10);
      const broken = rescheduled.filter((original) => {
        const moved = run.appointments.filter((a) => a.originalKey === original.key);
        return (
          moved.length !== 1 ||
          moved[0].patientKey !== original.patientKey ||
          moved[0].treatmentItem !== original.treatmentItem ||
          moved[0].startAt.getTime() <= original.startAt.getTime()
        );
      });
      expect(broken).toEqual([]);

      // 원 예약의 key가 더 작다 → key 순서대로 DB에 넣으면 원 예약이 먼저 들어간다
      const dangling = run.appointments.filter(
        (a) =>
          a.originalKey !== null &&
          (a.originalKey >= a.key || run.appointments[a.originalKey].status !== "RESCHEDULED"),
      );
      expect(dangling).toEqual([]);
    }
  });
});

describe("노쇼 누적", () => {
  it("환자의 noShowCount는 그 환자의 노쇼 예약 수와 같다", () => {
    for (const run of runs) {
      const counts = new Map<number, number>();
      for (const appointment of run.appointments) {
        if (appointment.status !== "NO_SHOW") continue;
        counts.set(appointment.patientKey, (counts.get(appointment.patientKey) ?? 0) + 1);
      }
      expect(run.patients.filter((p) => p.noShowCount !== (counts.get(p.key) ?? 0))).toEqual([]);
    }
  });

  it("약 2%의 환자가 노쇼 3회 이상이다 (노쇼 반복 고객)", () => {
    for (const run of runs) {
      const repeaters = run.patients.filter((p) => p.noShowCount >= 3).length;
      expect(repeaters).toBeGreaterThanOrEqual(4);
      expect(repeaters).toBeLessThanOrEqual(22);
    }
  });
});

describe("상태 이력", () => {
  it("모든 예약에 이력이 있고, 첫 행은 등록, 마지막 행은 현재 상태다", () => {
    for (const run of runs) {
      const grouped = groupLogs(run.statusLogs);
      expect(grouped.size).toBe(run.appointments.length);
      const invalid = run.appointments.filter((a) => {
        const logs = grouped.get(a.key) ?? [];
        const first = logs[0];
        const last = logs[logs.length - 1];
        return (
          logs.length < 1 ||
          logs.length > 3 ||
          first.fromStatus !== null ||
          first.toStatus !== "BOOKED" ||
          first.reasonCode !== null ||
          last.toStatus !== a.status ||
          last.reasonCode !== a.reasonCode
        );
      });
      expect(invalid).toEqual([]);
    }
  });

  it("이력은 끊기지 않고 이어지며 시각이 항상 앞으로 간다", () => {
    for (const run of runs) {
      const broken = [...groupLogs(run.statusLogs).values()].filter((logs) =>
        logs.some(
          (log, i) =>
            i > 0 &&
            (log.fromStatus !== logs[i - 1].toStatus || log.createdAt.getTime() <= logs[i - 1].createdAt.getTime()),
        ),
      );
      expect(broken).toEqual([]);
    }
  });

  it("등록 → (확인완료) → 결과 하나. 그 밖의 순서는 만들지 않는다", () => {
    const allowed = new Set<string>();
    for (const result of ["ARRIVED", "NO_SHOW", "CANCELED_SAME_DAY", "CANCELED_ADVANCE", "RESCHEDULED"]) {
      allowed.add(`BOOKED>${result}`);
      allowed.add(`BOOKED>CONFIRMED>${result}`);
    }
    allowed.add("BOOKED");
    allowed.add("BOOKED>CONFIRMED");
    for (const run of runs) {
      const sequences = new Set(
        [...groupLogs(run.statusLogs).values()].map((logs) => logs.map((log) => log.toStatus).join(">")),
      );
      expect([...sequences].filter((sequence) => !allowed.has(sequence))).toEqual([]);
      // 전날 확인을 거친 것과 안 거친 것이 섞여 있다
      expect(sequences.has("BOOKED>ARRIVED")).toBe(true);
      expect(sequences.has("BOOKED>CONFIRMED>ARRIVED")).toBe(true);
      expect(sequences.has("BOOKED>CONFIRMED>NO_SHOW")).toBe(true);
    }
  });

  it("입력자는 프론트 직원 키, 입력 기기는 '가짜 데이터 생성기'다", () => {
    expect(data.statusLogs.filter((log) => log.staffKey !== "front1" || log.inputDevice !== FAKE_INPUT_DEVICE)).toEqual(
      [],
    );
    expect(FAKE_INPUT_DEVICE).toBe("가짜 데이터 생성기");
  });

  it("상태별 입력 시각 규칙을 지킨다", () => {
    for (const run of runs) {
      const grouped = groupLogs(run.statusLogs);
      const violations: string[] = [];
      for (const a of run.appointments) {
        const logs = grouped.get(a.key) ?? [];
        const createdAt = logs[0].createdAt;
        const resultAt = logs[logs.length - 1].createdAt;
        const dateKey = kstDateKey(a.startAt);
        const confirmed = logs.find((log) => log.toStatus === "CONFIRMED");

        if (createdAt.getTime() >= a.startAt.getTime()) violations.push(`${a.key}: 예약 시각 뒤에 등록`);
        if (a.channel !== "WALK_IN" && kstDateKey(createdAt) >= dateKey) violations.push(`${a.key}: 당일 등록`);
        if (confirmed && kstDateKey(confirmed.createdAt) >= dateKey) violations.push(`${a.key}: 전날 이전 확인이 아님`);

        if (a.status === "ARRIVED" && resultAt.getTime() !== a.arrivedAt?.getTime()) {
          violations.push(`${a.key}: 내원 이력 시각이 내원 시각과 다름`);
        }
        if (a.status === "NO_SHOW") {
          // 기획서 4-3 규칙 2: 예약 시각 + 유예시간 이후에만 노쇼 처리 가능
          const allowedFrom = noShowAllowedFrom(a.startAt, settings.noShowGraceMin);
          if (resultAt.getTime() < allowedFrom.getTime()) violations.push(`${a.key}: 유예시간 전 노쇼`);
          if (kstDateKey(resultAt) !== dateKey) violations.push(`${a.key}: 노쇼를 다른 날 입력`);
        }
        if (a.status === "CANCELED_SAME_DAY") {
          if (kstDateKey(resultAt) !== dateKey) violations.push(`${a.key}: 당일취소가 당일이 아님`);
          if (resultAt.getTime() >= a.startAt.getTime()) violations.push(`${a.key}: 예약 시각 뒤 당일취소`);
        }
        if (a.status === "CANCELED_ADVANCE" && kstDateKey(resultAt) >= dateKey) {
          violations.push(`${a.key}: 사전취소가 전날 이전이 아님`);
        }
        if (a.status === "RESCHEDULED" && resultAt.getTime() >= a.startAt.getTime()) {
          violations.push(`${a.key}: 예약 시각 뒤 변경`);
        }
      }
      expect(violations).toEqual([]);
    }
  });

  it("변경으로 생긴 새 예약은 원 예약이 변경 처리된 시각에 등록된다", () => {
    const grouped = groupLogs(data.statusLogs);
    const mismatched = data.appointments.filter((a) => {
      if (a.originalKey === null) return false;
      const originalLogs = grouped.get(a.originalKey) ?? [];
      const created = (grouped.get(a.key) ?? [])[0];
      return created.createdAt.getTime() !== originalLogs[originalLogs.length - 1].createdAt.getTime();
    });
    expect(mismatched).toEqual([]);
  });
});

describe("미래 시각", () => {
  it("아직 오지 않은 예약 말고는 now보다 뒤의 시각이 없다", () => {
    for (const run of runs) {
      expect(run.statusLogs.filter((log) => log.createdAt.getTime() > NOW_MS)).toEqual([]);
      expect(run.appointments.filter((a) => a.arrivedAt !== null && a.arrivedAt.getTime() > NOW_MS)).toEqual([]);
      expect(run.appointments.filter((a) => a.startAt.getTime() > NOW_MS && !isPending(a))).toEqual([]);
      expect(run.patients.filter((p) => p.birthDate >= TODAY)).toEqual([]);
    }
  });

  it("now가 진료 시작 전이면 오늘 예약은 모두 미확정 상태다", () => {
    const early = new Date("2026-11-10T22:00:00.000Z"); // KST 11/11 07:00
    const run = generateFakeData({ seed: 3, now: early });
    const today = run.appointments.filter((a) => kstDateKey(a.startAt) === TODAY);
    expect(today.length).toBeGreaterThan(0);
    expect(today.filter((a) => !isPending(a))).toEqual([]);
    expect(run.statusLogs.filter((log) => log.createdAt.getTime() > early.getTime())).toEqual([]);
  });
});

describe("옵션", () => {
  const custom: ClinicSettings = {
    ...settings,
    lateToleranceMin: 5,
    noShowGraceMin: 20,
    businessHours: {
      "0": null,
      "1": { open: "10:00", close: "13:00" },
      "2": null,
      "3": null,
      "4": { open: "14:00", close: "20:00" },
      "5": null,
      "6": null,
    },
    chairs: [
      { code: "A", name: "체어 A", kind: "CHAIR" },
      { code: "B", name: "체어 B", kind: "CHAIR" },
    ],
    treatmentItems: ["정기검진", "상담"],
  };
  const run = generateFakeData({
    seed: 5,
    now: NOW,
    patientCount: 80,
    monthsBack: 1,
    monthsAhead: 0,
    settings: custom,
    doctorKeys: ["d1"],
    frontKeys: ["f1", "f2"],
  });

  it("병원 설정의 진료시간·휴진일·체어·항목을 따른다", () => {
    expect(run.appointments.length).toBeGreaterThan(20);
    const invalid = run.appointments.filter(
      (a) =>
        !isInsideBusinessHours(a, custom.businessHours) ||
        !["A", "B"].includes(a.chairCode) ||
        !custom.treatmentItems.includes(a.treatmentItem) ||
        a.doctorKey !== "d1",
    );
    expect(invalid).toEqual([]);
  });

  it("monthsBack·monthsAhead만큼만 만든다", () => {
    const dateKeys = run.appointments.map((a) => kstDateKey(a.startAt));
    expect(dateKeys.filter((dateKey) => dateKey < addDays(TODAY, -30) || dateKey > TODAY)).toEqual([]);
  });

  it("설정의 유예시간·허용시간과 직원 키를 쓴다", () => {
    const grouped = groupLogs(run.statusLogs);
    const noShows = run.appointments.filter((a) => a.status === "NO_SHOW");
    expect(noShows.length).toBeGreaterThan(0);
    const tooEarly = noShows.filter((a) => {
      const logs = grouped.get(a.key) ?? [];
      const allowedFrom = noShowAllowedFrom(a.startAt, custom.noShowGraceMin);
      return logs[logs.length - 1].createdAt.getTime() < allowedFrom.getTime();
    });
    expect(tooEarly).toEqual([]);

    expect([...new Set(run.statusLogs.map((log) => log.staffKey))].sort()).toEqual(["f1", "f2"]);
    expect(
      run.appointments.some((a) => a.arrivedAt && isLateArrival(a.startAt, a.arrivedAt, custom.lateToleranceMin)),
    ).toBe(true);
  });

  it("비율표에 없는 항목도 고르게 섞여 나오고 30·60·90분 중 하나다", () => {
    const withNewItem = generateFakeData({
      seed: 9,
      now: NOW,
      patientCount: 120,
      monthsBack: 1,
      monthsAhead: 0,
      settings: { ...settings, treatmentItems: ["정기검진", "턱관절 치료"] },
    });
    const items = withNewItem.appointments.map((a) => a.treatmentItem);
    expect(new Set(items)).toEqual(new Set(["정기검진", "턱관절 치료"]));
    expect(share(items, (item) => item === "턱관절 치료")).toBeGreaterThan(0.05);
    expect(withNewItem.appointments.filter((a) => ![30, 60, 90].includes(a.durationMin))).toEqual([]);
  });

  it("직원 키나 예약 항목이 비어 있으면 거부한다", () => {
    expect(() => generateFakeData({ seed: 1, now: NOW, doctorKeys: [] })).toThrow(RangeError);
    expect(() => generateFakeData({ seed: 1, now: NOW, frontKeys: [] })).toThrow(RangeError);
    expect(() => generateFakeData({ seed: 1, now: NOW, settings: { ...settings, treatmentItems: [] } })).toThrow(
      RangeError,
    );
  });

  it("환자가 0명이면 예약도 없다", () => {
    expect(generateFakeData({ seed: 1, now: NOW, patientCount: 0 })).toEqual({
      patients: [],
      appointments: [],
      statusLogs: [],
    });
  });
});
