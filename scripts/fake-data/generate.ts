/**
 * 가짜 데이터 생성기 (T0-5) — 환자와 약 3개월분 예약·내원 상태 이력을 만든다.
 *
 * 절대 규칙 1: 개발·테스트에는 이 생성기가 만든 데이터만 쓴다. 실제 환자 정보는 한 글자도 넣지 않는다.
 * - 이름: 성 목록과 음절 목록을 무작위로 조합한다. 실제 사람 명단에서 가져온 것이 아니다.
 * - 전화번호: 010-0XXX-XXXX. 가운데 자리가 0으로 시작하는 휴대폰 번호는 가입자에게 배정되지 않으므로
 *   실제 사람의 번호일 수 없다.
 * - 모든 환자에 '가짜데이터' 태그를 붙여 나중에 가려내고 지울 수 있게 한다.
 *
 * 순수 함수다. DB를 모르고, Math.random·Date.now를 쓰지 않는다. seed와 now가 같으면 결과가 같다.
 * 매번 다른 데이터를 만드는 것(새 seed)과 DB에 넣는 것은 실행 스크립트(run.ts)의 일이다.
 * 직원은 키("doctor1", "front1")로만 가리키고, 실제 id는 DB에 넣을 때 정한다.
 */

import type { AppointmentChannel, AppointmentStatus, VisitReasonCode } from "@/lib/domain/appointment";
import { DEFAULT_CLINIC_SETTINGS, type BusinessHours, type ClinicSettings } from "@/lib/domain/clinic";
import type { Gender, ReferralSource, VisitType } from "@/lib/domain/patient";
import {
  addDays,
  diffDays,
  kstDateKey,
  kstDateTime,
  kstDayStart,
  kstMinutesOfDay,
  kstWeekday,
  type DateKey,
} from "@/lib/time/kst";
import { noShowAllowedFrom } from "@/lib/visit/lateness";

export type FakeDataOptions = {
  /** 난수 seed. 같은 seed와 now면 같은 데이터가 나온다. */
  seed: number;
  /** 기준 시각. 이 시각보다 뒤의 일(내원, 상태 입력)은 만들지 않는다. */
  now: Date;
  /** 환자 수 (기본 500) */
  patientCount?: number;
  /** 과거 몇 개월분 예약을 만들지 (기본 2, 한 달은 30일로 센다) — 통계용 */
  monthsBack?: number;
  /** 앞으로 몇 개월분 예약을 만들지 (기본 1) — 캘린더용 */
  monthsAhead?: number;
  settings?: ClinicSettings;
  /** 담당 의사 키 */
  doctorKeys?: string[];
  /** 예약 등록·상태 입력을 한 프론트 직원 키 */
  frontKeys?: string[];
};

export type FakePatient = {
  /** 예약이 환자를 가리키는 번호 (배열 순번) */
  key: number;
  name: string;
  /** 정규화된 번호: "0100" + 숫자 7자리 */
  phone: string;
  /** "YYYY-MM-DD" */
  birthDate: DateKey;
  gender: Gender;
  visitType: VisitType;
  referralSource: ReferralSource;
  tags: string[];
  dentwebChartNo: string | null;
  memo: string | null;
  /** 이 환자의 NO_SHOW 예약 수 */
  noShowCount: number;
};

export type FakeAppointment = {
  /** 이력과 변경 예약이 이 예약을 가리키는 번호 (배열 순번) */
  key: number;
  patientKey: number;
  startAt: Date;
  durationMin: number;
  chairCode: string;
  doctorKey: string;
  treatmentItem: string;
  channel: AppointmentChannel;
  status: AppointmentStatus;
  /** NO_SHOW·CANCELED_SAME_DAY에만 있다 (기획서 4-3 규칙 3) */
  reasonCode: VisitReasonCode | null;
  /** 내원 입력 시각. ARRIVED에만 있다. */
  arrivedAt: Date | null;
  /** 예약변경으로 생긴 예약이면 원 예약의 key. 항상 자기 key보다 작다. */
  originalKey: number | null;
};

/** visit_status_log 한 행. 예약의 status는 이 이력의 마지막 toStatus와 같다. */
export type FakeStatusLog = {
  appointmentKey: number;
  /** 예약 등록 행은 null */
  fromStatus: AppointmentStatus | null;
  toStatus: AppointmentStatus;
  reasonCode: VisitReasonCode | null;
  /** 입력자 */
  staffKey: string;
  /** 입력 시각 */
  createdAt: Date;
  inputDevice: string;
};

export type FakeData = {
  patients: FakePatient[];
  appointments: FakeAppointment[];
  /** 예약 key 순, 같은 예약 안에서는 시간순 */
  statusLogs: FakeStatusLog[];
};

/** 모든 가짜 환자에 붙는 태그 */
export const FAKE_DATA_TAG = "가짜데이터";
export const FAKE_INPUT_DEVICE = "가짜 데이터 생성기";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
/** 예약 시작 시각의 단위(분) */
const SLOT_MIN = 30;
/** 상담실만 쓰는 예약 항목 */
const CONSULT_ITEM = "상담";

type Weighted<T> = readonly (readonly [T, number])[];

// ── 이름·메모 재료 ─────────────────────────────────────────────────────────────
const FAMILY_NAMES: Weighted<string> = [
  ["김", 21], ["이", 15], ["박", 8], ["최", 5], ["정", 4], ["강", 2], ["조", 2], ["윤", 2], ["장", 2], ["임", 2],
  ["한", 1.5], ["오", 1.5], ["서", 1.5], ["신", 1.5], ["권", 1.5], ["황", 1.5], ["안", 1.5], ["송", 1.5], ["류", 1], ["홍", 1],
];
const GIVEN_NAME_SYLLABLES = [..."서지민준현우예은하윤도연수아진영정성태경주원승유채호재동미희석혜선인규나다솔빈훈"];
/** 진료 내용이 아닌 응대 메모만 쓴다 (절대 규칙 3) */
const MEMOS = [
  "오후 시간대 선호",
  "전화보다 문자 연락 선호",
  "주차 안내 필요",
  "보호자와 함께 방문",
  "토요일 예약 선호",
  "예약 전날 확인 전화 요청",
];

// ── 비율 ──────────────────────────────────────────────────────────────────────
const REFERRAL_WEIGHTS: Weighted<ReferralSource> = [
  ["PHONE", 30], ["WEBSITE", 20], ["PLATFORM", 20], ["REFERRAL", 22], ["OTHER", 8],
];
const CHANNEL_WEIGHTS: Weighted<AppointmentChannel> = [
  ["PHONE", 45], ["WEBSITE", 20], ["PLATFORM", 20], ["ONSITE", 15],
];
/**
 * 기본 예약 항목의 비중과 항목별 소요시간(분) 비율. 실제 치과처럼 정기검진·스케일링·충치 치료가 많고
 * 임플란트·교정·미백은 드물다. 병원 설정에서 바꾼 항목처럼 표에 없는 항목은
 * OTHER_ITEM_WEIGHT 비중과 DURATION_WEIGHTS를 쓴다.
 */
const TREATMENT_ITEM_PROFILES = new Map<string, { weight: number; durations: Weighted<number> }>([
  ["정기검진", { weight: 24, durations: [[30, 85], [60, 15]] }],
  ["스케일링", { weight: 20, durations: [[30, 60], [60, 40]] }],
  ["충치 치료", { weight: 18, durations: [[30, 60], [60, 40]] }],
  ["신경 치료", { weight: 9, durations: [[30, 10], [60, 60], [90, 30]] }],
  ["상담", { weight: 8, durations: [[30, 70], [60, 30]] }],
  ["보철", { weight: 7, durations: [[30, 40], [60, 50], [90, 10]] }],
  ["발치", { weight: 6, durations: [[30, 50], [60, 50]] }],
  ["임플란트", { weight: 4, durations: [[60, 40], [90, 60]] }],
  ["교정", { weight: 2, durations: [[30, 70], [60, 30]] }],
  ["미백", { weight: 2, durations: [[60, 70], [90, 30]] }],
]);
const OTHER_ITEM_WEIGHT = 6;
const DURATION_WEIGHTS: Weighted<number> = [[30, 55], [60, 35], [90, 10]];
/**
 * 지난 날 예약의 결과. 여기에 노쇼 반복 고객의 노쇼(전체의 약 2%)가 더해져
 * 전체로는 내원 82% · 노쇼 7% · 당일취소 5% · 사전취소 3% · 변경 3% 정도가 된다.
 */
const PAST_STATUS_WEIGHTS: Weighted<AppointmentStatus> = [
  ["ARRIVED", 84.5], ["NO_SHOW", 4.5], ["CANCELED_SAME_DAY", 5], ["CANCELED_ADVANCE", 3], ["RESCHEDULED", 3],
];
const NO_SHOW_REASONS: Weighted<VisitReasonCode> = [
  ["NO_CONTACT", 70], ["PERSONAL", 15], ["OTHER_CLINIC", 5], ["OTHER", 10],
];
const SAME_DAY_CANCEL_REASONS: Weighted<VisitReasonCode> = [
  ["PERSONAL", 70], ["OTHER_CLINIC", 10], ["OTHER", 20],
];

/** 다른 환자와 번호를 같이 쓰는 비율 (가족) — 중복 경고·뒷자리 검색 확인용 */
const SHARED_PHONE_RATE = 0.02;
const CHART_NO_RATE = 0.8;
const MEMO_RATE = 0.1;
/** 생성 범위 안에 첫 예약이 있는 환자(신규)의 비율 */
const NEW_PATIENT_RATE = 0.3;
/** 노쇼 반복 고객의 비율. 지난 날 중 3~5일에 노쇼를 낸다. */
const REPEAT_NO_SHOW_RATE = 0.02;
/** 진료 체어 1대·1시간당 예약 수. 체어 4대·9시간이면 하루 26~44건 */
const LOAD_PER_CHAIR_HOUR = { min: 0.72, max: 1.22 };
/** 오늘 이미 지난 예약은 이 건수마다 1건을 미확인으로 남긴다 — 내원 보드에 처리할 행이 늘 있게 */
const TODAY_PENDING_EVERY = 6;
/** 아직 오지 않은 예약 중 확인완료 비율 */
const PENDING_CONFIRMED_RATE = 0.3;
/** 내원·노쇼·당일취소로 끝난 예약 중 전날 확인완료를 거친 비율 */
const CONFIRM_STEP_RATE = 0.6;
/** 내원 중 예약 없이 온 고객(워크인)의 비율 */
const WALK_IN_RATE = 0.05;
/** 내원 중 지각(허용시간 초과)의 비율 */
const LATE_RATE = 0.13;

// ── 난수 ──────────────────────────────────────────────────────────────────────
/** seed로 정해지는 난수(mulberry32) */
function createRandom(seed: number) {
  let state = seed >>> 0;
  /** 0 이상 1 미만 */
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /** min 이상 max 이하 정수 */
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  const chance = (probability: number): boolean => next() < probability;
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)];
  /** [값, 가중치] 표에서 가중치에 비례해 하나를 뽑는다 */
  const weighted = <T>(table: Weighted<T>): T => {
    let total = 0;
    for (let i = 0; i < table.length; i++) total += table[i][1];
    let roll = next() * total;
    for (let i = 0; i < table.length - 1; i++) {
      roll -= table[i][1];
      if (roll < 0) return table[i][0];
    }
    return table[table.length - 1][0];
  };
  return { next, int, chance, pick, weighted };
}

type Random = ReturnType<typeof createRandom>;

// ── 환자 ──────────────────────────────────────────────────────────────────────
function generatePatients(rng: Random, count: number, todayKey: DateKey): FakePatient[] {
  const patients: FakePatient[] = [];
  const usedPhones = new Set<string>();

  const newPhone = (): string => {
    for (;;) {
      const phone = `0100${String(rng.int(0, 9_999_999)).padStart(7, "0")}`;
      if (!usedPhones.has(phone)) {
        usedPhones.add(phone);
        return phone;
      }
    }
  };
  const givenName = (): string => {
    const first = rng.pick(GIVEN_NAME_SYLLABLES);
    let second = rng.pick(GIVEN_NAME_SYLLABLES);
    while (second === first) second = rng.pick(GIVEN_NAME_SYLLABLES);
    return first + second;
  };

  for (let key = 0; key < count; key++) {
    // 가족: 앞에서 만든 환자와 성과 전화번호가 같다
    const family = key > 0 && rng.chance(SHARED_PHONE_RATE) ? patients[rng.int(0, key - 1)] : null;
    const familyName = family ? family.name.slice(0, 1) : rng.weighted(FAMILY_NAMES);
    const referralSource = rng.weighted(REFERRAL_WEIGHTS);

    const tags = [FAKE_DATA_TAG];
    if (referralSource === "REFERRAL" && rng.chance(0.6)) tags.push("소개고객");
    if (rng.chance(0.06)) tags.push("VIP");

    patients.push({
      key,
      name: familyName + givenName(),
      phone: family ? family.phone : newPhone(),
      birthDate: addDays(todayKey, -rng.int(5 * 366, 85 * 365)), // 약 5~85세
      gender: rng.chance(0.5) ? "FEMALE" : "MALE",
      visitType: "RETURNING", // 예약을 만든 뒤 신규 여부를 확정한다
      referralSource,
      tags,
      dentwebChartNo: rng.chance(CHART_NO_RATE) ? `F${String(key + 1).padStart(6, "0")}` : null,
      memo: rng.chance(MEMO_RATE) ? rng.pick(MEMOS) : null,
      noShowCount: 0,
    });
  }
  return patients;
}

// ── 진료일 ────────────────────────────────────────────────────────────────────
type OpenDay = {
  key: DateKey;
  /** 진료 시작 시각 */
  openAt: Date;
  /** 30분 칸 수 (진료 시작 ~ 마감) */
  slotCount: number;
};

/** from~to(포함) 사이의 진료일. 휴진일은 빠진다. */
function listOpenDays(businessHours: BusinessHours, from: DateKey, to: DateKey): OpenDay[] {
  const days: OpenDay[] = [];
  for (let key = from; key <= to; key = addDays(key, 1)) {
    const hours = businessHours[String(kstWeekday(key)) as keyof BusinessHours];
    if (!hours) continue;
    const openAt = kstDateTime(key, hours.open);
    const openMs = kstDateTime(key, hours.close).getTime() - openAt.getTime();
    const slotCount = Math.floor(openMs / (SLOT_MIN * MINUTE_MS));
    if (slotCount > 0) days.push({ key, openAt, slotCount });
  }
  return days;
}

// ── 생성 ──────────────────────────────────────────────────────────────────────
/** 이 예약이 어떻게 생겼는지 */
type BookingOrigin = {
  /** 노쇼 반복 고객의 정해진 노쇼 */
  forceNoShow?: boolean;
  /** 예약변경으로 옮겨 온 예약이면 원 예약과 변경 처리 시각 */
  movedFrom?: { original: FakeAppointment; at: Date };
};

export function generateFakeData(options: FakeDataOptions): FakeData {
  const {
    seed,
    now,
    patientCount = 500,
    monthsBack = 2,
    monthsAhead = 1,
    settings = DEFAULT_CLINIC_SETTINGS,
    doctorKeys = ["doctor1", "doctor2"],
    frontKeys = ["front1"],
  } = options;
  if (doctorKeys.length === 0 || frontKeys.length === 0 || settings.treatmentItems.length === 0) {
    throw new RangeError("의사 키, 프론트 직원 키, 예약 항목이 각각 하나 이상 있어야 합니다");
  }

  const rng = createRandom(seed);
  const nowMs = now.getTime();
  const todayKey = kstDateKey(now);

  const patients = generatePatients(rng, patientCount, todayKey);
  const firstDay = addDays(todayKey, -30 * monthsBack);
  const lastDay = addDays(todayKey, 30 * monthsAhead);
  const days = listOpenDays(settings.businessHours, firstDay, lastDay);
  const pastDayCount = days.filter((day) => day.key < todayKey).length;

  const appointments: FakeAppointment[] = [];
  const logsByAppointment: FakeStatusLog[][] = [];
  /** 오늘 예약 중 예약 시각이 이미 지난 것의 수 */
  let todayPastCount = 0;

  const itemWeights: Weighted<string> = settings.treatmentItems.map((item) => [
    item,
    TREATMENT_ITEM_PROFILES.get(item)?.weight ?? OTHER_ITEM_WEIGHT,
  ]);

  const treatmentChairs = settings.chairs.filter((chair) => chair.kind === "CHAIR").map((chair) => chair.code);
  const consultRooms = settings.chairs.filter((chair) => chair.kind === "CONSULT_ROOM").map((chair) => chair.code);

  /** 날짜별로 찬 자리 ("체어코드:칸 번호") */
  const occupied = days.map(() => new Set<string>());
  /** 날짜별로 예약이 있는 환자 — 한 환자를 같은 날 두 번 뽑지 않는다 */
  const dayPatients = days.map(() => new Set<number>());
  /** 날짜별로 미리 정해 둔 방문: 신규 환자의 첫 예약, 노쇼 반복 고객의 노쇼 */
  const plannedVisits: { patientKey: number; origin: BookingOrigin }[][] = days.map(() => []);
  /** 환자가 예약을 잡을 수 있는 첫 진료일 다음 순번. 재진은 0(처음부터), 신규는 첫 예약일 + 1 */
  const eligibleFrom: number[] = [];
  /** 환자별 방문 빈도: 자주 오는 환자와 한두 번 오는 환자가 섞이게 한다 */
  const visitWeights: (readonly [number, number])[] = [];

  for (const patient of patients) {
    visitWeights.push([patient.key, 0.4 + rng.next()]);
    eligibleFrom.push(0);
    if (rng.chance(REPEAT_NO_SHOW_RATE)) {
      const noShowDays = new Set<number>();
      const wanted = Math.min(rng.int(3, 5), pastDayCount);
      while (noShowDays.size < wanted) noShowDays.add(rng.int(0, pastDayCount - 1));
      for (const dayIdx of noShowDays) {
        plannedVisits[dayIdx].push({ patientKey: patient.key, origin: { forceNoShow: true } });
      }
    } else if (days.length > 0 && rng.chance(NEW_PATIENT_RATE)) {
      const firstDayIdx = rng.int(0, days.length - 1);
      plannedVisits[firstDayIdx].push({ patientKey: patient.key, origin: {} });
      eligibleFrom[patient.key] = firstDayIdx + 1;
    }
  }

  /** 접수·상담실이 입력했을 법한 시각: 그 날짜의 09:00~18:00 */
  const officeTime = (dateKey: DateKey): Date =>
    new Date(kstDayStart(dateKey).getTime() + rng.int(9 * 3600, 18 * 3600) * SECOND_MS);

  /** 예약을 등록한 시각: 예약일 1~21일 전. 앞으로의 예약이라도 오늘보다 전에 등록된 것으로 한다. */
  const bookingTime = (dateKey: DateKey): Date => {
    const day = addDays(dateKey, -rng.int(1, 21));
    return officeTime(day < todayKey ? day : addDays(todayKey, -rng.int(1, 14)));
  };

  /** 사전취소·예약변경 연락을 받은 시각: 등록 이후, 예약일 하루 이상 전 */
  const advanceNoticeTime = (dateKey: DateKey, createdAt: Date): Date => {
    const daysBefore = rng.int(1, diffDays(kstDateKey(createdAt), dateKey));
    const at = officeTime(addDays(dateKey, -daysBefore));
    return at.getTime() > createdAt.getTime() ? at : new Date(createdAt.getTime() + rng.int(5, 60) * MINUTE_MS);
  };

  /** 예약 시각 대비 도착 시각(초). 대부분 15분 전 ~ 10분 후, 일부는 허용시간을 넘겨 지각한다. */
  const arrivalOffsetSec = (): number => {
    const tolerance = settings.lateToleranceMin;
    return rng.chance(LATE_RATE)
      ? rng.int((tolerance + 1) * 60, (tolerance + 30) * 60)
      : rng.int(-15 * 60, Math.min(10, tolerance) * 60);
  };

  const pendingStatus = (): AppointmentStatus => (rng.chance(PENDING_CONFIRMED_RATE) ? "CONFIRMED" : "BOOKED");

  /** 그 날 chairs 중 한 곳에서 연속 slots칸이 빈 자리를 찾는다. 없으면 null. */
  const findFreeSlot = (dayIdx: number, chairs: string[], slots: number) => {
    const starts = days[dayIdx].slotCount - slots + 1;
    if (starts <= 0 || chairs.length === 0) return null;
    const firstStart = rng.int(0, starts - 1);
    const firstChair = rng.int(0, chairs.length - 1);
    for (let i = 0; i < starts; i++) {
      const slot = (firstStart + i) % starts;
      for (let j = 0; j < chairs.length; j++) {
        const chairCode = chairs[(firstChair + j) % chairs.length];
        let free = true;
        for (let k = 0; k < slots; k++) free = free && !occupied[dayIdx].has(`${chairCode}:${slot + k}`);
        if (free) return { chairCode, slot };
      }
    }
    return null;
  };

  /** 그 날 예약을 잡을 환자를 방문 빈도에 따라 뽑는다. */
  const pickPatient = (dayIdx: number): number | null => {
    for (let attempt = 0; attempt < 30 && visitWeights.length > 0; attempt++) {
      const patientKey = rng.weighted(visitWeights);
      if (eligibleFrom[patientKey] <= dayIdx && !dayPatients[dayIdx].has(patientKey)) return patientKey;
    }
    return null;
  };

  /**
   * 예약 하나와 그 상태 이력을 만든다. 빈 자리가 없으면 아무것도 만들지 않고 false.
   * 이력은 등록 → (전날 확인완료) → 결과 하나의 순서만 만든다.
   */
  function book(dayIdx: number, patientKey: number, origin: BookingOrigin = {}): boolean {
    const day = days[dayIdx];
    const moved = origin.movedFrom;

    // 1) 항목·소요시간·자리
    const treatmentItem = moved?.original.treatmentItem ?? rng.weighted(itemWeights);
    // 소요시간은 항목에 맞춰 30·60·90분 중 하나. 진료시간이 그보다 짧은 날은 그 날 길이에 맞춘다.
    const wantedMin =
      moved?.original.durationMin ??
      rng.weighted(TREATMENT_ITEM_PROFILES.get(treatmentItem)?.durations ?? DURATION_WEIGHTS);
    const durationMin = Math.min(wantedMin, day.slotCount * SLOT_MIN);
    const chairs = treatmentItem === CONSULT_ITEM && consultRooms.length > 0 ? consultRooms : treatmentChairs;
    const place = findFreeSlot(dayIdx, chairs, durationMin / SLOT_MIN);
    if (!place) return false;
    const startAt = new Date(day.openAt.getTime() + place.slot * SLOT_MIN * MINUTE_MS);

    // 2) 상태: 지난 날은 결과가 정해져 있고, 오늘은 now 이전만 내원 처리(몇 건은 미확인), 그 뒤는 미확정
    let status: AppointmentStatus;
    if (day.key < todayKey) {
      status = origin.forceNoShow ? "NO_SHOW" : rng.weighted(PAST_STATUS_WEIGHTS);
    } else if (startAt.getTime() <= nowMs) {
      status = todayPastCount % TODAY_PENDING_EVERY === 1 ? pendingStatus() : "ARRIVED";
      todayPastCount += 1;
    } else {
      status = pendingStatus();
    }

    let arrivedAt: Date | null = null;
    let walkIn = false;
    if (status === "ARRIVED") {
      walkIn = !moved && rng.chance(WALK_IN_RATE);
      // 워크인은 와서 바로 다음 빈 시간에 넣은 것이라 지각이 없다
      const offsetSec = walkIn ? -rng.int(0, 10 * 60) : arrivalOffsetSec();
      arrivedAt = new Date(startAt.getTime() + offsetSec * SECOND_MS);
      if (arrivedAt.getTime() > nowMs) {
        // 아직 도착 전이다 (오늘 예약)
        status = pendingStatus();
        arrivedAt = null;
        walkIn = false;
      }
    }

    // 3) 시각: 등록 → 확인완료 → 결과
    let createdAt: Date;
    if (moved) createdAt = moved.at;
    else if (walkIn && arrivedAt) createdAt = new Date(arrivedAt.getTime() - rng.int(20, 120) * SECOND_MS);
    else createdAt = bookingTime(day.key);

    let confirmedAt: Date | null = null;
    const endsOnTheDay = status === "ARRIVED" || status === "NO_SHOW" || status === "CANCELED_SAME_DAY";
    if (status === "CONFIRMED" || (endsOnTheDay && !walkIn && rng.chance(CONFIRM_STEP_RATE))) {
      const dayBefore = officeTime(addDays(day.key, -1));
      if (dayBefore.getTime() > createdAt.getTime() && dayBefore.getTime() <= nowMs) {
        confirmedAt = dayBefore;
      } else if (status === "CONFIRMED") {
        // 전날이 아직 오지 않았거나 전날 늦게 등록된 예약: 등록 이후 지금까지(예약일 전) 중 한 시점에 확인받았다
        const latest = Math.min(nowMs, kstDayStart(day.key).getTime() - SECOND_MS);
        const spanSec = Math.floor((latest - createdAt.getTime()) / SECOND_MS);
        confirmedAt = new Date(createdAt.getTime() + rng.int(1, spanSec) * SECOND_MS);
      }
    }

    let resultAt: Date | null = null;
    let reasonCode: VisitReasonCode | null = null;
    if (status === "ARRIVED") {
      resultAt = arrivedAt;
    } else if (status === "NO_SHOW") {
      // 기획서 4-3 규칙 2: 예약 시각 + 유예시간이 지난 뒤에만 노쇼 처리
      const allowedFrom = noShowAllowedFrom(startAt, settings.noShowGraceMin);
      resultAt = new Date(allowedFrom.getTime() + rng.int(0, 3600) * SECOND_MS);
      reasonCode = rng.weighted(NO_SHOW_REASONS);
    } else if (status === "CANCELED_SAME_DAY") {
      // 당일, 예약 시각 전에 취소 연락
      const sinceMidnight = kstMinutesOfDay(startAt);
      const minutesBefore = rng.int(Math.min(10, sinceMidnight), Math.min(240, sinceMidnight));
      resultAt = new Date(startAt.getTime() - minutesBefore * MINUTE_MS);
      reasonCode = rng.weighted(SAME_DAY_CANCEL_REASONS);
    } else if (status === "CANCELED_ADVANCE" || status === "RESCHEDULED") {
      resultAt = advanceNoticeTime(day.key, createdAt);
    }

    // 4) 예약 저장
    const appointment: FakeAppointment = {
      key: appointments.length,
      patientKey,
      startAt,
      durationMin,
      chairCode: place.chairCode,
      doctorKey: moved?.original.doctorKey ?? rng.pick(doctorKeys),
      treatmentItem,
      channel: moved?.original.channel ?? (walkIn ? "WALK_IN" : rng.weighted(CHANNEL_WEIGHTS)),
      status,
      reasonCode,
      arrivedAt,
      originalKey: moved?.original.key ?? null,
    };
    appointments.push(appointment);
    dayPatients[dayIdx].add(patientKey);
    // DB 제약은 자리를 차지하는 상태(SLOT_HOLDING_STATUSES)끼리만 겹침을 막지만, 여기서는 모든 예약이 자리를 막는다.
    // 노쇼·취소된 예약도 등록될 때는 자리를 차지하고 있었으므로, 같은 자리에 먼저 잡혀 있던 다른 예약이 있을 수 없다.
    for (let k = 0; k < durationMin / SLOT_MIN; k++) {
      occupied[dayIdx].add(`${place.chairCode}:${place.slot + k}`);
    }

    // 5) 예약변경이면 뒤의 진료일에 새 예약을 잡는다. 잡을 날이 없으면 사전취소로 남긴다.
    if (status === "RESCHEDULED" && resultAt) {
      let rebooked = false;
      for (let target = dayIdx + rng.int(1, 10); target < days.length && !rebooked; target++) {
        if (dayPatients[target].has(patientKey)) continue;
        rebooked = book(target, patientKey, { movedFrom: { original: appointment, at: resultAt } });
      }
      if (!rebooked) appointment.status = "CANCELED_ADVANCE";
    }
    if (appointment.status === "NO_SHOW") patients[patientKey].noShowCount += 1;

    // 6) 상태 이력
    const log = (
      fromStatus: AppointmentStatus | null,
      toStatus: AppointmentStatus,
      at: Date,
      reason: VisitReasonCode | null = null,
    ): FakeStatusLog => ({
      appointmentKey: appointment.key,
      fromStatus,
      toStatus,
      reasonCode: reason,
      staffKey: rng.pick(frontKeys),
      createdAt: at,
      inputDevice: FAKE_INPUT_DEVICE,
    });
    const logs = [log(null, "BOOKED", createdAt)];
    if (confirmedAt) logs.push(log("BOOKED", "CONFIRMED", confirmedAt));
    if (resultAt) logs.push(log(confirmedAt ? "CONFIRMED" : "BOOKED", appointment.status, resultAt, reasonCode));
    logsByAppointment[appointment.key] = logs;
    return true;
  }

  days.forEach((day, dayIdx) => {
    // 그 날의 예약 수. 다른 날에서 옮겨 온 예약과 미리 정해 둔 방문도 여기에 들어간다.
    const chairHours = (treatmentChairs.length * day.slotCount * SLOT_MIN) / 60;
    // 오늘은 내원 보드·캘린더에 보이는 날이라 지금 앞뒤로 예약이 넉넉하도록 가장 바쁜 날로 둔다.
    const spread = rng.next();
    const load =
      day.key === todayKey
        ? LOAD_PER_CHAIR_HOUR.max
        : LOAD_PER_CHAIR_HOUR.min + spread * (LOAD_PER_CHAIR_HOUR.max - LOAD_PER_CHAIR_HOUR.min);
    const target = Math.round(chairHours * load);
    const isFull = () => dayPatients[dayIdx].size >= target;

    for (const visit of plannedVisits[dayIdx]) {
      if (!isFull()) book(dayIdx, visit.patientKey, visit.origin);
    }
    for (let tries = target * 3; tries > 0 && !isFull(); tries--) {
      const patientKey = pickPatient(dayIdx);
      if (patientKey === null) break; // 그 날 더 잡을 환자가 없다
      book(dayIdx, patientKey);
    }
  });

  // 신규: 생성 범위 안에 첫 예약이 있는 환자. 예약이 하나도 안 잡힌 환자는 재진(예전 고객)으로 둔다.
  const hasAppointment = new Set(appointments.map((appointment) => appointment.patientKey));
  for (const patient of patients) {
    if (eligibleFrom[patient.key] > 0 && hasAppointment.has(patient.key)) patient.visitType = "NEW";
  }

  return { patients, appointments, statusLogs: logsByAppointment.flat() };
}
