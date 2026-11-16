/**
 * T0-5 완료 기준 — 가짜 데이터를 DB에 넣는다 (scripts/fake-data/run.ts의 insertFakeData).
 * 행 수, 체어 중복 제약, 예약 상태 = 마지막 이력, 노쇼 횟수, 전화번호 대역(010-0XXX), 실행 거부를 확인한다.
 */
import { randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openBirthDate, openPhone } from "@/server/crypto/pii";
import { generateFakeData, type FakeData } from "../../scripts/fake-data/generate";
import {
  FAKE_DOCTOR_KEYS,
  FAKE_FRONT_KEYS,
  FakeDataError,
  appointmentTimeRange,
  insertFakeData,
} from "../../scripts/fake-data/run";
import { createStaff, db, resetDb } from "./helpers";

const NOW = new Date("2026-11-11T05:00:00.000Z"); // KST 2026-11-11(수) 14:00
const ALLOWED = { env: { FAKE_DATA_ALLOWED: "true" } };

const generate = (seed: number): FakeData =>
  generateFakeData({ seed, now: NOW, patientCount: 40, doctorKeys: FAKE_DOCTOR_KEYS, frontKeys: FAKE_FRONT_KEYS });

const data = generate(20261111);

beforeAll(() => {
  // 키는 테스트마다 새로 만든다. 저장소에는 키 문자열을 두지 않는다.
  process.env.PII_ENC_KEY = randomBytes(32).toString("base64");
  process.env.PII_HMAC_KEY = randomBytes(32).toString("base64");
});

beforeEach(async () => {
  await resetDb();
  // 시드 계정과 같은 login_id (prisma/seed.ts)
  await createStaff({ loginId: "doctor1", role: "DOCTOR" });
  await createStaff({ loginId: "doctor2", role: "DOCTOR" });
  await createStaff({ loginId: "front1", role: "FRONT" });
});

/** 예약 상태·내원 시각·예약변경 연결·노쇼 횟수가 상태 이력과 맞지 않는 행 */
async function inconsistentRows() {
  const statusVsLog = await db.$queryRaw<{ id: string }[]>`
    SELECT a.id FROM appointment a
    LEFT JOIN LATERAL (
      SELECT to_status, created_at FROM visit_status_log l
      WHERE l.appointment_id = a.id ORDER BY l.created_at DESC, l.id DESC LIMIT 1
    ) last ON true
    WHERE last.to_status IS DISTINCT FROM a.status
       OR (a.status = 'ARRIVED') <> (a.arrived_at IS NOT NULL)
       OR (a.status = 'ARRIVED' AND a.arrived_at <> last.created_at)
  `;
  const firstLog = await db.$queryRaw<{ id: string }[]>`
    SELECT a.id FROM appointment a
    WHERE NOT EXISTS (
      SELECT 1 FROM visit_status_log l
      WHERE l.appointment_id = a.id AND l.from_status IS NULL AND l.to_status = 'BOOKED' AND l.created_at = a.created_at
    )
  `;
  const noShowCount = await db.$queryRaw<{ id: string }[]>`
    SELECT p.id FROM patient p
    WHERE p.no_show_count <> (SELECT count(*) FROM appointment a WHERE a.patient_id = p.id AND a.status = 'NO_SHOW')
  `;
  // 예약변경된 예약에는 새 예약이 하나 있고, 원 예약을 가리키는 예약의 원 예약은 예약변경 상태다
  const reschedule = await db.$queryRaw<{ id: string }[]>`
    SELECT a.id FROM appointment a
    LEFT JOIN appointment moved ON moved.original_appointment_id = a.id
    WHERE (a.status = 'RESCHEDULED') <> (moved.id IS NOT NULL)
       OR (moved.id IS NOT NULL AND moved.patient_id <> a.patient_id)
  `;
  return { statusVsLog, firstLog, noShowCount, reschedule };
}

const CONSISTENT = { statusVsLog: [], firstLog: [], noShowCount: [], reschedule: [] };

describe("insertFakeData — 넣기", () => {
  it("생성한 행이 모두 체어 중복 에러 없이 들어간다", async () => {
    const summary = await insertFakeData(db, data, ALLOWED);

    expect(summary).toMatchObject({
      patients: data.patients.length,
      appointments: data.appointments.length,
      statusLogs: data.statusLogs.length,
      skippedAppointments: 0,
    });
    expect(await db.patient.count()).toBe(data.patients.length);
    expect(await db.appointment.count()).toBe(data.appointments.length);
    expect(await db.visitStatusLog.count()).toBe(data.statusLogs.length);
    expect(data.appointments.length).toBeGreaterThan(100);

    const byStatus = await db.appointment.groupBy({ by: ["status"], _count: true });
    for (const { status, _count } of byStatus) expect(summary.appointmentsByStatus[status]).toBe(_count);
  });

  it("예약 상태는 마지막 이력의 to_status와 같고, 내원 시각·노쇼 횟수·예약변경 연결이 이력과 맞는다", async () => {
    await insertFakeData(db, data, ALLOWED);
    expect(await inconsistentRows()).toEqual(CONSISTENT);
    // 노쇼·예약변경이 실제로 들어 있어 위 검사가 빈 검사가 아니다
    expect(await db.appointment.count({ where: { status: "NO_SHOW" } })).toBeGreaterThan(0);
    expect(await db.appointment.count({ where: { originalAppointmentId: { not: null } } })).toBeGreaterThan(0);
    expect(await db.patient.count({ where: { noShowCount: { gt: 0 } } })).toBeGreaterThan(0);
  });

  it("이력은 생성기가 정한 과거 시각으로 들어가고, 직원은 시드 계정으로 연결된다", async () => {
    await insertFakeData(db, data, ALLOWED);
    const [oldest] = await db.visitStatusLog.findMany({ orderBy: { createdAt: "asc" }, take: 1 });
    const generatedOldest = Math.min(...data.statusLogs.map((log) => log.createdAt.getTime()));
    expect(oldest.createdAt.getTime()).toBe(generatedOldest);

    const front = await db.staff.findUniqueOrThrow({ where: { loginId: "front1" } });
    expect(await db.visitStatusLog.count({ where: { staffId: { not: front.id } } })).toBe(0);
    const doctors = await db.staff.findMany({ where: { loginId: { in: FAKE_DOCTOR_KEYS } } });
    expect(await db.appointment.count({ where: { doctorId: { notIn: doctors.map((d) => d.id) } } })).toBe(0);
  });

  it("저장된 전화번호는 모두 010-0XXX 대역으로 복호화되고, 생년월일도 생성한 값과 같다", async () => {
    await insertFakeData(db, data, ALLOWED);
    const rows = await db.patient.findMany({ select: { phoneEnc: true, birthDateEnc: true } });
    const phones = rows.map((row) => openPhone(row.phoneEnc));
    for (const phone of phones) expect(phone).toMatch(/^0100\d{7}$/);
    expect(phones.sort()).toEqual(data.patients.map((p) => p.phone).sort());
    expect(rows.map((row) => openBirthDate(row.birthDateEnc as string)).sort()).toEqual(
      data.patients.map((p) => p.birthDate).sort(),
    );
  });
});

describe("insertFakeData — 실행 거부", () => {
  it("FAKE_DATA_ALLOWED=true가 아니면 아무것도 넣지 않는다", async () => {
    for (const env of [{}, { FAKE_DATA_ALLOWED: "1" }, { FAKE_DATA_ALLOWED: "TRUE" }]) {
      await expect(insertFakeData(db, data, { env })).rejects.toThrow(FakeDataError);
      await expect(insertFakeData(db, data, { env })).rejects.toThrow(/FAKE_DATA_ALLOWED=true/);
    }
    expect(await db.patient.count()).toBe(0);
  });

  it("시드 계정이 없으면 db:seed를 안내하고 아무것도 넣지 않는다", async () => {
    await resetDb();
    await createStaff({ loginId: "doctor1", role: "DOCTOR" });
    await expect(insertFakeData(db, data, ALLOWED)).rejects.toThrow(/doctor2, front1.*npm run db:seed/);
    expect(await db.patient.count()).toBe(0);
  });

  it("환자가 이미 있으면 db:fresh를 안내하고 멈춘다", async () => {
    await insertFakeData(db, data, ALLOWED);
    await expect(insertFakeData(db, generate(7), ALLOWED)).rejects.toThrow(/npm run db:fresh/);
    expect(await db.patient.count()).toBe(data.patients.length);
  });
});

describe("insertFakeData — --append", () => {
  it("기존 예약과 겹치는 예약은 빼고 더 넣으며, 상태·노쇼 횟수는 여전히 이력과 맞는다", async () => {
    await insertFakeData(db, data, ALLOWED);
    const more = generate(7);
    const summary = await insertFakeData(db, more, { ...ALLOWED, append: true });

    // 같은 체어 수에 두 번째 일정을 겹쳐 넣으므로 일부는 반드시 빠진다
    expect(summary.skippedAppointments).toBeGreaterThan(0);
    expect(summary.appointments + summary.skippedAppointments).toBe(more.appointments.length);
    expect(await db.patient.count()).toBe(data.patients.length + more.patients.length);
    expect(await db.appointment.count()).toBe(data.appointments.length + summary.appointments);
    expect(await db.visitStatusLog.count()).toBe(data.statusLogs.length + summary.statusLogs);
    expect(await inconsistentRows()).toEqual(CONSISTENT);
  });
});

describe("appointmentTimeRange — --append가 기존 예약을 찾는 시간 범위", () => {
  it("가장 이른 시작부터 가장 늦은 끝까지다", () => {
    const { from, to } = appointmentTimeRange(data.appointments);
    const starts = data.appointments.map((a) => a.startAt.getTime());
    const ends = data.appointments.map((a) => a.startAt.getTime() + a.durationMin * 60_000);
    expect(from.getTime()).toBe(Math.min(...starts));
    expect(to.getTime()).toBe(Math.max(...ends));
  });

  it("예약이 수십만 개여도 스택이 넘치지 않는다 (--patients 100000 수준)", () => {
    const base = data.appointments[0];
    const many = Array.from({ length: 600_000 }, (_, i) => ({
      ...base,
      startAt: new Date(base.startAt.getTime() + i * 60_000),
    }));
    const { from, to } = appointmentTimeRange(many);
    expect(from.getTime()).toBe(base.startAt.getTime());
    expect(to.getTime()).toBe(base.startAt.getTime() + 599_999 * 60_000 + base.durationMin * 60_000);
  });
});
