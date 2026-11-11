/**
 * T7-2 통계 API (GET /api/stats) — 숫자는 summarizeVisits와 같고, 원장·관리자만 보며, 개인 식별 정보가 없고, 2초 안에 응답한다.
 */
import { randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/stats/route";
import type { AppointmentChannel, AppointmentStatus } from "@/lib/domain/appointment";
import { DEFAULT_CLINIC_SETTINGS } from "@/lib/domain/clinic";
import { summarizeVisits, bucketVisits, type VisitRow } from "@/lib/stats/visit-stats";
import { addDays, kstDateKey, kstDateTime, kstMonthKey } from "@/lib/time/kst";
import { generateFakeData } from "../../scripts/fake-data/generate";
import { FAKE_DOCTOR_KEYS, FAKE_FRONT_KEYS, insertFakeData } from "../../scripts/fake-data/run";
import { callRoute, loginAs } from "./helpers/api";
import { createAppointment, createPatient, createStaff, db, resetDb } from "./helpers";

beforeEach(resetDb);

const LATE_TOLERANCE_MIN = 10;

async function createClinicSetting(lateToleranceMin = LATE_TOLERANCE_MIN) {
  const { businessHours, chairs, treatmentItems, noShowGraceMin } = DEFAULT_CLINIC_SETTINGS;
  await db.clinicSetting.create({ data: { id: 1, lateToleranceMin, noShowGraceMin, businessHours, chairs, treatmentItems } });
}

const url = (from: string, to: string, unit = "day") => `/api/stats?from=${from}&to=${to}&unit=${unit}`;

/** 오늘(한국 시간) 기준으로 알려진 예약 묶음을 만든다. 체어 중복 제약을 피하려고 건마다 시각을 다르게 한다. */
async function seedKnownAppointments() {
  const today = kstDateKey(new Date());
  const day = (offset: number) => addDays(today, offset);
  const patient = await createPatient({ name: "가상환자통계", phoneHash: "test-placeholder-stats-hash" });
  type Spec = { date: string; time: string; status: AppointmentStatus; channel: AppointmentChannel; arrivedAfterMin?: number };
  const specs: Spec[] = [
    { date: day(-10), time: "10:00", status: "ARRIVED", channel: "PHONE", arrivedAfterMin: 0 },
    { date: day(-10), time: "11:00", status: "ARRIVED", channel: "PHONE", arrivedAfterMin: LATE_TOLERANCE_MIN }, // 정확히 허용시간 → 지각 아님
    { date: day(-10), time: "12:00", status: "LEFT", channel: "WEBSITE", arrivedAfterMin: LATE_TOLERANCE_MIN + 1 }, // 지각
    { date: day(-9), time: "10:00", status: "NO_SHOW", channel: "PHONE" },
    { date: day(-9), time: "11:00", status: "CANCELED_SAME_DAY", channel: "PLATFORM" },
    { date: day(-9), time: "12:00", status: "CANCELED_ADVANCE", channel: "PHONE" },
    { date: day(-3), time: "10:00", status: "RESCHEDULED", channel: "WEBSITE" },
    { date: day(-3), time: "11:00", status: "BOOKED", channel: "PHONE" }, // 미확인
    { date: day(-3), time: "12:00", status: "PAID", channel: "WALK_IN", arrivedAfterMin: 0 },
    { date: day(2), time: "10:00", status: "CONFIRMED", channel: "PHONE" }, // 대기
    { date: day(-40), time: "10:00", status: "NO_SHOW", channel: "PHONE" }, // 기간 밖
  ];
  for (const spec of specs) {
    const startAt = kstDateTime(spec.date, spec.time);
    await createAppointment({
      patientId: patient.id,
      startAt,
      status: spec.status,
      channel: spec.channel,
      arrivedAt: spec.arrivedAfterMin === undefined ? null : new Date(startAt.getTime() + spec.arrivedAfterMin * 60_000),
    });
  }
  return { patient, from: day(-14), to: day(7) };
}

async function rowsBetween(from: string, to: string): Promise<(VisitRow & { channel: AppointmentChannel })[]> {
  return db.appointment.findMany({
    where: { startAt: { gte: kstDateTime(from, "00:00"), lt: kstDateTime(addDays(to, 1), "00:00") } },
    select: { startAt: true, status: true, arrivedAt: true, channel: true },
  });
}

describe("GET /api/stats — 숫자", () => {
  it("전체·구간·채널별 숫자가 같은 행에 summarizeVisits를 돌린 값과 같다", async () => {
    await createClinicSetting();
    const { from, to } = await seedKnownAppointments();
    const { cookie } = await loginAs("DOCTOR");

    const res = await callRoute(GET, { url: url(from, to, "week"), cookie });

    expect(res.status).toBe(200);
    const asOf = new Date(res.json.asOf);
    const options = { asOf, lateToleranceMin: LATE_TOLERANCE_MIN };
    const rows = await rowsBetween(from, to);
    expect(rows).toHaveLength(10);
    expect(res.json.range).toEqual({ from, to, days: 22 });
    expect(res.json.unit).toBe("week");
    expect(res.json.lateToleranceMin).toBe(LATE_TOLERANCE_MIN);
    expect(res.json.total).toEqual(summarizeVisits(rows, options));
    expect(res.json.buckets).toEqual(bucketVisits(rows, { ...options, unit: "week" }));
    // 알려진 값으로도 확인: 내원 4(지각 1), 노쇼 1, 당일취소 1, 미확인 1 → 유효 예약 7
    expect(res.json.total).toMatchObject({
      arrived: 4,
      late: 1,
      noShow: 1,
      sameDayCancel: 1,
      advanceCancel: 1,
      rescheduled: 1,
      unconfirmed: 1,
      upcoming: 1,
      booked: 7,
    });
    expect(res.json.total.arrivalRate).toBeCloseTo(4 / 7);
    expect(res.json.total.lateRate).toBeCloseTo(1 / 4);

    const walkIn = res.json.byChannel.find((c: { channel: string }) => c.channel === "WALK_IN");
    expect(walkIn.stats).toEqual(summarizeVisits(rows.filter((r) => r.channel === "WALK_IN"), options));
    expect(walkIn.stats.arrived).toBe(1);
    expect(res.json.byChannel.map((c: { channel: string }) => c.channel)).toEqual([
      "PHONE",
      "WEBSITE",
      "PLATFORM",
      "ONSITE",
      "WALK_IN",
    ]);
    expect(res.json.definitions.length).toBeGreaterThan(0);
  });

  it("일·월 단위 구간 키는 한국 시간 날짜·달이다", async () => {
    await createClinicSetting();
    const { from, to } = await seedKnownAppointments();
    const { cookie } = await loginAs("ADMIN");
    const today = kstDateKey(new Date());

    const byDay = await callRoute(GET, { url: url(from, to, "day"), cookie });
    expect(byDay.json.buckets.map((b: { key: string }) => b.key)).toEqual(
      [addDays(today, -10), addDays(today, -9), addDays(today, -3), addDays(today, 2)].sort(),
    );
    const byMonth = await callRoute(GET, { url: url(from, to, "month"), cookie });
    for (const bucket of byMonth.json.buckets) expect(bucket.key).toMatch(/^\d{4}-\d{2}$/);
  });

  it("기간 끝과 구간 키는 UTC가 아니라 한국 시간 자정으로 자른다", async () => {
    await createClinicSetting();
    // 두 달 전 한 달 전체(1일~말일)를 기간으로 잡는다. 한국 00:10은 UTC로 전날, 23:50은 UTC로도 같은 날이다.
    const firstOfMonth = (key: string) => `${kstMonthKey(key)}-01`;
    const thisMonth = firstOfMonth(kstDateKey(new Date()));
    const lastMonth = firstOfMonth(addDays(thisMonth, -1));
    const from = firstOfMonth(addDays(lastMonth, -1));
    const to = addDays(lastMonth, -1);
    const patient = await createPatient({ name: "가상환자경계", phoneHash: "test-placeholder-stats-edge-hash" });
    const specs = [
      { date: addDays(from, -1), time: "23:50", chair: "C1" }, // 기간 밖 (전날 밤)
      { date: from, time: "00:10", chair: "C2" }, // 기간 안 (첫날 새벽, UTC로는 전날)
      { date: to, time: "23:50", chair: "C1" }, // 기간 안 (마지막 날 밤)
      { date: addDays(to, 1), time: "00:10", chair: "C2" }, // 기간 밖 (다음 날 새벽, UTC로는 마지막 날)
    ];
    for (const spec of specs) {
      const startAt = kstDateTime(spec.date, spec.time);
      await createAppointment({ patientId: patient.id, startAt, chair: spec.chair, status: "ARRIVED", arrivedAt: startAt });
    }
    const { cookie } = await loginAs("ADMIN");

    const byDay = await callRoute(GET, { url: url(from, to, "day"), cookie });
    expect(byDay.status).toBe(200);
    expect(byDay.json.total).toMatchObject({ arrived: 2, booked: 2 });
    expect(byDay.json.buckets.map((b: { key: string; stats: { arrived: number } }) => [b.key, b.stats.arrived])).toEqual([
      [from, 1],
      [to, 1],
    ]);

    const byMonth = await callRoute(GET, { url: url(from, to, "month"), cookie });
    expect(byMonth.json.buckets.map((b: { key: string; stats: { arrived: number } }) => [b.key, b.stats.arrived])).toEqual([
      [kstMonthKey(from), 2],
    ]);
  });

  it("병원 설정이 없으면 지각 허용시간 기본값(15분)으로 센다", async () => {
    const { from, to } = await seedKnownAppointments();
    const { cookie } = await loginAs("ADMIN");
    const res = await callRoute(GET, { url: url(from, to), cookie });
    expect(res.json.lateToleranceMin).toBe(15);
    expect(res.json.total.late).toBe(0); // 11분 늦은 내원은 15분 기준으로 지각이 아니다
  });
});

describe("GET /api/stats — 권한·감사", () => {
  it("프론트·상담은 403, 거부 감사 행이 남는다", async () => {
    for (const role of ["FRONT", "COUNSELOR"] as const) {
      const { cookie, staff } = await loginAs(role);
      const res = await callRoute(GET, { url: url("2026-11-01", "2026-11-30"), cookie });
      expect(res.status).toBe(403);
      expect(res.json.error.code).toBe("FORBIDDEN");
      const audit = await db.auditLog.findMany({ where: { staffId: staff.id } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ action: "STATS_READ", result: "DENIED" });
    }
  });

  it("로그인하지 않으면 401", async () => {
    const res = await callRoute(GET, { url: url("2026-11-01", "2026-11-30") });
    expect(res.status).toBe(401);
  });

  it("성공하면 STATS_READ 감사 행 하나: 환자 없음, detail은 일수·행 수", async () => {
    const { from, to } = await seedKnownAppointments();
    const { cookie, staff } = await loginAs("DOCTOR");
    await callRoute(GET, { url: url(from, to), cookie });
    const audit = await db.auditLog.findMany({ where: { staffId: staff.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "STATS_READ", result: "SUCCESS", patientId: null });
    expect(audit[0].detail).toEqual({ days: 22, rows: 10, patientCount: 0 });
  });

  it("잘못된 기간은 400 (형식, 순서, 366일 초과)", async () => {
    const { cookie } = await loginAs("ADMIN");
    const bad = [
      [url("2026-13-01", "2026-11-30"), "VALIDATION_FAILED"],
      [url("2026-11-01", "2026-11-30", "year"), "VALIDATION_FAILED"],
      ["/api/stats?from=2026-11-01", "VALIDATION_FAILED"],
      [url("2026-11-30", "2026-11-01"), "INVALID_RANGE"],
      [url("2025-11-10", "2026-11-11"), "RANGE_TOO_LONG"], // 367일
    ] as const;
    for (const [path, code] of bad) {
      const res = await callRoute(GET, { url: path, cookie });
      expect(res.status, path).toBe(400);
      expect(res.json.error.code, path).toBe(code);
    }
    const ok = await callRoute(GET, { url: url("2025-11-11", "2026-11-11"), cookie }); // 366일
    expect(ok.status).toBe(200);
    expect(ok.json.range.days).toBe(366);
  });
});

/** 응답 JSON의 모든 키 */
function allKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) allKeys(item, keys);
  else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      keys.add(key);
      allKeys(item, keys);
    }
  }
  return keys;
}

describe("GET /api/stats — 개인 식별 정보 없음", () => {
  it("응답에 환자 id·이름·전화번호 키나 값이 없다", async () => {
    await createClinicSetting();
    const { patient, from, to } = await seedKnownAppointments();
    const { cookie } = await loginAs("ADMIN");

    for (const unit of ["day", "week", "month"]) {
      const res = await callRoute(GET, { url: url(from, to, unit), cookie });
      expect(res.status).toBe(200);
      const keys = [...allKeys(res.json)].map((key) => key.toLowerCase());
      for (const forbidden of ["id", "patientid", "patient", "name", "phone", "birth", "memo"]) {
        expect(keys.some((key) => key.includes(forbidden)), forbidden).toBe(false);
      }
      expect(res.text).not.toContain(patient.id);
      expect(res.text).not.toContain(patient.name);
      expect(res.text).not.toMatch(/010-?0\d{3}-?\d{4}/);
      expect(res.text).not.toMatch(/0100\d{7}/);
      expect(res.text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    }
  });
});

describe("GET /api/stats — 성능 (가짜 데이터 500명·약 3개월)", () => {
  beforeAll(() => {
    // 가짜 데이터의 전화번호·생년월일 암호화용. 키는 실행마다 새로 만들고 저장소에 두지 않는다.
    process.env.PII_ENC_KEY = randomBytes(32).toString("base64");
    process.env.PII_HMAC_KEY = randomBytes(32).toString("base64");
  });

  it(
    "3개월 기간을 일·주·월로 조회해도 각각 2초 안에 응답한다",
    async () => {
      for (const loginId of [...FAKE_DOCTOR_KEYS, ...FAKE_FRONT_KEYS]) {
        await createStaff({ loginId, role: loginId.startsWith("doctor") ? "DOCTOR" : "FRONT" });
      }
      await createClinicSetting(DEFAULT_CLINIC_SETTINGS.lateToleranceMin);
      const now = new Date();
      const data = generateFakeData({
        seed: 20261111,
        now,
        patientCount: 500,
        doctorKeys: FAKE_DOCTOR_KEYS,
        frontKeys: FAKE_FRONT_KEYS,
      });
      const summary = await insertFakeData(db, data, { env: { FAKE_DATA_ALLOWED: "true" } });
      const { cookie } = await loginAs("DOCTOR");
      const today = kstDateKey(now);
      const from = addDays(today, -60);
      const to = addDays(today, 30);

      const timings: string[] = [];
      for (const unit of ["day", "week", "month"]) {
        const started = performance.now();
        const res = await callRoute(GET, { url: url(from, to, unit), cookie });
        const elapsed = performance.now() - started;
        expect(res.status).toBe(200);
        expect(res.json.total.booked).toBeGreaterThan(0);
        expect(elapsed).toBeLessThan(2000);
        timings.push(`${unit} ${elapsed.toFixed(0)}ms`);
      }
      process.stdout.write(
        `[T7-2 성능] 환자 ${summary.patients}, 예약 ${summary.appointments}, 기간 ${from}~${to}(91일): ${timings.join(", ")}\n`,
      );
    },
    120_000,
  );
});
