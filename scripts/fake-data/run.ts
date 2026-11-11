/**
 * 가짜 데이터 넣기 (T0-5) — generate.ts가 만든 환자·예약·내원 상태 이력을 PostgreSQL에 넣는다.
 *
 * 실행: npm run fake:data [-- --seed <n>] [--patients <n>] [--now <ISO 시각>] [--append]
 *   처음부터 다시 만들려면 npm run db:fresh (db:reset → db:seed → fake:data).
 *
 * - FAKE_DATA_ALLOWED=true일 때만 실행한다. 실제 운영 DB에는 이 변수를 두지 않으므로 운영 DB에는 넣을 수 없다.
 * - 환자가 이미 있으면 멈춘다. --append를 주면 더 넣는다. 이때 기존 예약과 같은 체어·시간이 겹치는 예약은
 *   (예약변경으로 이어진 예약까지 함께) 넣지 않고, 이미 쓰인 차트번호는 비운다.
 * - 지우는 기능은 없다. visit_status_log·감사 로그는 추가만 가능하므로(절대 규칙 5) "처음부터 다시"는
 *   개발 DB를 다시 만드는 것(db:reset)으로만 한다.
 * - seed를 주지 않으면 실행할 때마다 새 seed를 뽑는다 → 매번 다른 이름·번호. seed와 기준 시각을 출력하므로
 *   --seed·--now로 같은 데이터를 다시 만들 수 있다.
 * - 전화번호·생년월일은 sealPhone·sealBirthDate로 암호화해 넣는다. 평문은 DB에 들어가지 않는다.
 * - 출력에는 건수와 seed만 넣는다. 이름·번호는 어디에도 출력하지 않는다(절대 규칙 6).
 *
 * "server-only"를 import하는 모듈을 Next.js 밖에서 쓰므로 Node 옵션 --conditions=react-server로 실행한다.
 */
import { randomBytes, randomInt } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { APPOINTMENT_STATUSES, APPOINTMENT_STATUS_LABEL, type AppointmentStatus } from "@/lib/domain/appointment";
import { sealBirthDate, sealPhone } from "@/server/crypto/pii";
import { FAKE_DATA_NOT_ALLOWED_MESSAGE, isFakeDataAllowed } from "./allowed";
import { generateFakeData, type FakeAppointment, type FakeData, type FakeStatusLog } from "./generate";

/** 생성기의 직원 키 = 시드 계정의 login_id (prisma/seed.ts) */
export const FAKE_DOCTOR_KEYS = ["doctor1", "doctor2"];
export const FAKE_FRONT_KEYS = ["front1"];

const DEFAULT_PATIENT_COUNT = 500;
const MAX_PATIENT_COUNT = 100_000;
/** createMany 한 번에 넣는 행 수 */
const BATCH_SIZE = 1000;
const MINUTE_MS = 60_000;

/** 실행을 거부한 이유. 메시지에 환자 정보를 넣지 않으므로 그대로 출력해도 된다. */
export class FakeDataError extends Error {
  override name = "FakeDataError";
}

// process.env를 그대로 넘길 수 있게 다른 변수도 받는다(쓰지는 않는다).
export type FakeDataEnv = {
  [name: string]: string | undefined;
  FAKE_DATA_ALLOWED?: string;
};

export type InsertOptions = {
  env: FakeDataEnv;
  /** 환자가 이미 있어도 더 넣는다 */
  append?: boolean;
};

export type InsertSummary = {
  patients: number;
  appointments: number;
  statusLogs: number;
  appointmentsByStatus: Record<AppointmentStatus, number>;
  /** --append에서 기존 예약과 겹쳐 넣지 않은 예약 수 */
  skippedAppointments: number;
};

/** 시각 순으로 정렬되는 UUID v7. 행의 (과거) 생성 시각을 앞 48비트에 넣는다. */
function uuid7(at: Date): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(at.getTime(), 0, 6);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function endAtOf(appointment: FakeAppointment): Date {
  return new Date(appointment.startAt.getTime() + appointment.durationMin * MINUTE_MS);
}

/**
 * 예약들이 차지하는 시간 범위(가장 이른 시작 ~ 가장 늦은 끝). 예약이 수십만 개여도 되도록
 * Math.min(...배열) 대신 반복문으로 구한다(인자 펼치기는 약 12만 개를 넘으면 스택이 넘친다).
 */
export function appointmentTimeRange(appointments: FakeAppointment[]): { from: Date; to: Date } {
  let from = Infinity;
  let to = -Infinity;
  for (const appointment of appointments) {
    from = Math.min(from, appointment.startAt.getTime());
    to = Math.max(to, endAtOf(appointment).getTime());
  }
  return { from: new Date(from), to: new Date(to) };
}

/**
 * 기존 예약과 같은 체어·시간이 겹치는 예약을 뺀다. 예약변경으로 이어진 예약(원 예약 ↔ 새 예약)은 함께 뺀다.
 * 노쇼 횟수는 남은 예약으로 다시 센다. 기존 예약이 없으면 그대로 돌려준다.
 */
function withoutClashes(
  data: FakeData,
  existing: { chair: string; startAt: Date; endAt: Date }[],
): { data: FakeData; skipped: number } {
  if (existing.length === 0) return { data, skipped: 0 };

  const byChair = new Map<string, { start: number; end: number }[]>();
  for (const { chair, startAt, endAt } of existing) {
    const list = byChair.get(chair) ?? [];
    list.push({ start: startAt.getTime(), end: endAt.getTime() });
    byChair.set(chair, list);
  }
  const clashes = (appointment: FakeAppointment) => {
    const start = appointment.startAt.getTime();
    const end = endAtOf(appointment).getTime();
    return (byChair.get(appointment.chairCode) ?? []).some((slot) => slot.start < end && start < slot.end);
  };

  // 예약변경 사슬: 원 예약은 새 예약을 하나만 가진다.
  const childOf = new Map<number, number>();
  for (const appointment of data.appointments) {
    if (appointment.originalKey !== null) childOf.set(appointment.originalKey, appointment.key);
  }
  const dropped = new Set<number>();
  for (const appointment of data.appointments) {
    if (dropped.has(appointment.key) || !clashes(appointment)) continue;
    let root = appointment;
    while (root.originalKey !== null) root = data.appointments[root.originalKey];
    for (let key: number | undefined = root.key; key !== undefined; key = childOf.get(key)) dropped.add(key);
  }
  if (dropped.size === 0) return { data, skipped: 0 };

  const appointments = data.appointments.filter((appointment) => !dropped.has(appointment.key));
  const noShows = new Map<number, number>();
  for (const appointment of appointments) {
    if (appointment.status === "NO_SHOW") noShows.set(appointment.patientKey, (noShows.get(appointment.patientKey) ?? 0) + 1);
  }
  return {
    data: {
      patients: data.patients.map((patient) => ({ ...patient, noShowCount: noShows.get(patient.key) ?? 0 })),
      appointments,
      statusLogs: data.statusLogs.filter((log) => !dropped.has(log.appointmentKey)),
    },
    skipped: dropped.size,
  };
}

/** 예약별 상태 이력. 예약의 status·arrivedAt이 이력과 맞는지 넣기 전에 확인한다(생성기 버그 방지). */
function logsByAppointment(data: FakeData): Map<number, FakeStatusLog[]> {
  const logs = new Map<number, FakeStatusLog[]>();
  for (const log of data.statusLogs) {
    const list = logs.get(log.appointmentKey) ?? [];
    list.push(log);
    logs.set(log.appointmentKey, list);
  }
  for (const appointment of data.appointments) {
    const list = logs.get(appointment.key);
    const last = list?.at(-1);
    if (!list || list[0].fromStatus !== null || last?.toStatus !== appointment.status) {
      throw new FakeDataError(`생성된 예약 ${appointment.key}의 상태가 상태 이력과 맞지 않습니다`);
    }
    if ((appointment.status === "ARRIVED") !== (appointment.arrivedAt !== null)) {
      throw new FakeDataError(`생성된 예약 ${appointment.key}의 내원 시각이 상태와 맞지 않습니다`);
    }
  }
  return logs;
}

async function createInBatches<T>(rows: T[], insert: (batch: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) await insert(rows.slice(i, i + BATCH_SIZE));
}

/**
 * 생성한 가짜 데이터를 한 트랜잭션으로 넣는다. 하나라도 실패하면 아무것도 남지 않는다.
 * 직원 키는 같은 login_id의 직원으로 바꾼다(npm run db:seed가 만든 계정).
 */
export async function insertFakeData(db: PrismaClient, generated: FakeData, options: InsertOptions): Promise<InsertSummary> {
  if (!isFakeDataAllowed(options.env)) throw new FakeDataError(FAKE_DATA_NOT_ALLOWED_MESSAGE);

  return db.$transaction(
    async (tx) => {
      if (!options.append && (await tx.patient.findFirst({ select: { id: true } }))) {
        throw new FakeDataError(
          "환자 데이터가 이미 있습니다. 처음부터 다시 만들려면 npm run db:fresh, 기존 데이터에 더 넣으려면 --append를 붙이세요.",
        );
      }

      // 직원 키 → id
      const staffKeys = [
        ...new Set([...generated.appointments.map((a) => a.doctorKey), ...generated.statusLogs.map((l) => l.staffKey)]),
      ];
      const staff = await tx.staff.findMany({ where: { loginId: { in: staffKeys } }, select: { id: true, loginId: true } });
      const staffIds = new Map(staff.map((s) => [s.loginId, s.id]));
      const missing = staffKeys.filter((key) => !staffIds.has(key));
      if (missing.length > 0) {
        throw new FakeDataError(`시드 계정(${missing.join(", ")})이 없습니다. npm run db:seed를 먼저 실행하세요.`);
      }
      const staffId = (key: string) => staffIds.get(key) as string;

      // --append: 기존 예약과 겹치는 예약을 빼고, 이미 쓰인 차트번호를 비운다.
      let data = generated;
      let skipped = 0;
      if (options.append && data.appointments.length > 0) {
        const { from, to } = appointmentTimeRange(data.appointments);
        const existing = await tx.appointment.findMany({
          where: { startAt: { lt: to }, endAt: { gt: from } },
          select: { chair: true, startAt: true, endAt: true },
        });
        ({ data, skipped } = withoutClashes(data, existing));
      }
      let usedChartNos = new Set<string>();
      if (options.append) {
        const chartNos = data.patients.flatMap((p) => (p.dentwebChartNo ? [p.dentwebChartNo] : []));
        const rows = await tx.patient.findMany({
          where: { dentwebChartNo: { in: chartNos } },
          select: { dentwebChartNo: true },
        });
        usedChartNos = new Set(rows.map((row) => row.dentwebChartNo as string));
      }

      const logs = logsByAppointment(data);
      const now = new Date();

      // 환자: 등록 시각은 첫 예약을 등록한 시각, 예약이 없으면 지금
      const firstBooking = new Map<number, FakeStatusLog>();
      for (const appointment of data.appointments) {
        const booking = (logs.get(appointment.key) as FakeStatusLog[])[0];
        const known = firstBooking.get(appointment.patientKey);
        if (!known || booking.createdAt < known.createdAt) firstBooking.set(appointment.patientKey, booking);
      }
      const patientIds = new Map<number, string>();
      const patientRows: Prisma.PatientCreateManyInput[] = data.patients.map((patient) => {
        const booking = firstBooking.get(patient.key);
        const createdAt = booking?.createdAt ?? now;
        const id = uuid7(createdAt);
        patientIds.set(patient.key, id);
        return {
          id,
          name: patient.name,
          ...sealPhone(patient.phone),
          birthDateEnc: sealBirthDate(patient.birthDate),
          gender: patient.gender,
          visitType: patient.visitType,
          referralSource: patient.referralSource,
          tags: patient.tags,
          noShowCount: patient.noShowCount,
          dentwebChartNo: patient.dentwebChartNo && !usedChartNos.has(patient.dentwebChartNo) ? patient.dentwebChartNo : null,
          memo: patient.memo,
          createdById: booking ? staffId(booking.staffKey) : null,
          createdAt,
          updatedAt: createdAt,
        };
      });

      // 예약: 등록 시각·등록자는 첫 이력 행, 수정 시각은 마지막 이력 행
      const appointmentIds = new Map<number, string>();
      const appointmentRows: Prisma.AppointmentCreateManyInput[] = data.appointments.map((appointment) => {
        const list = logs.get(appointment.key) as FakeStatusLog[];
        const booking = list[0];
        const id = uuid7(booking.createdAt);
        appointmentIds.set(appointment.key, id);
        return {
          id,
          patientId: patientIds.get(appointment.patientKey) as string,
          startAt: appointment.startAt,
          durationMin: appointment.durationMin,
          endAt: endAtOf(appointment),
          doctorId: staffId(appointment.doctorKey),
          chair: appointment.chairCode,
          treatmentItem: appointment.treatmentItem,
          channel: appointment.channel,
          status: appointment.status,
          arrivedAt: appointment.arrivedAt,
          // 원 예약은 항상 key가 더 작아 먼저 들어간다
          originalAppointmentId: appointment.originalKey === null ? null : appointmentIds.get(appointment.originalKey),
          createdById: staffId(booking.staffKey),
          createdAt: booking.createdAt,
          updatedAt: (list.at(-1) as FakeStatusLog).createdAt,
        };
      });

      const logRows: Prisma.VisitStatusLogCreateManyInput[] = data.statusLogs.map((log) => ({
        id: uuid7(log.createdAt),
        appointmentId: appointmentIds.get(log.appointmentKey) as string,
        fromStatus: log.fromStatus,
        toStatus: log.toStatus,
        reasonCode: log.reasonCode,
        staffId: staffId(log.staffKey),
        createdAt: log.createdAt,
        inputDevice: log.inputDevice,
      }));

      await createInBatches(patientRows, (batch) => tx.patient.createMany({ data: batch }));
      await createInBatches(appointmentRows, (batch) => tx.appointment.createMany({ data: batch }));
      await createInBatches(logRows, (batch) => tx.visitStatusLog.createMany({ data: batch }));

      const appointmentsByStatus = Object.fromEntries(APPOINTMENT_STATUSES.map((status) => [status, 0])) as Record<
        AppointmentStatus,
        number
      >;
      for (const appointment of data.appointments) appointmentsByStatus[appointment.status] += 1;

      return {
        patients: patientRows.length,
        appointments: appointmentRows.length,
        statusLogs: logRows.length,
        appointmentsByStatus,
        skippedAppointments: skipped,
      };
    },
    { maxWait: 10_000, timeout: 300_000 },
  );
}

type CliOptions = { seed: number; patientCount: number; now: Date; append: boolean };

function parseCli(args: string[]): CliOptions {
  const { values } = parseArgs({
    args,
    options: {
      seed: { type: "string" },
      patients: { type: "string" },
      now: { type: "string" },
      append: { type: "boolean", default: false },
    },
    strict: true,
  });
  const integer = (value: string, name: string, min: number, max: number): number => {
    const n = Number(value);
    if (!/^\d+$/.test(value) || n < min || n > max) {
      throw new FakeDataError(`--${name}는 ${min} 이상 ${max} 이하의 정수여야 합니다.`);
    }
    return n;
  };
  const now = values.now === undefined ? new Date() : new Date(values.now);
  if (Number.isNaN(now.getTime())) throw new FakeDataError("--now는 ISO 시각이어야 합니다 (예: 2026-11-11T05:00:00Z).");
  return {
    // seed는 32비트 정수(생성기가 >>> 0으로 쓴다)
    seed: values.seed === undefined ? randomInt(2 ** 32) : integer(values.seed, "seed", 0, 2 ** 32 - 1),
    patientCount:
      values.patients === undefined ? DEFAULT_PATIENT_COUNT : integer(values.patients, "patients", 1, MAX_PATIENT_COUNT),
    now,
    append: values.append ?? false,
  };
}

async function main() {
  const dotenv = await import("dotenv");
  dotenv.config({ quiet: true });
  const options = parseCli(process.argv.slice(2));
  // DB에 접속하기 전에 막는다(insertFakeData도 다시 확인한다).
  if (!isFakeDataAllowed(process.env)) throw new FakeDataError(FAKE_DATA_NOT_ALLOWED_MESSAGE);

  console.log(`가짜 데이터 seed: ${options.seed}, 기준 시각: ${options.now.toISOString()}`);
  console.log(`  같은 데이터를 다시 만들려면: npm run fake:data -- --seed ${options.seed} --now ${options.now.toISOString()}`);

  const startedAt = Date.now();
  const data = generateFakeData({
    seed: options.seed,
    now: options.now,
    patientCount: options.patientCount,
    doctorKeys: FAKE_DOCTOR_KEYS,
    frontKeys: FAKE_FRONT_KEYS,
  });

  const { db } = await import("@/server/db");
  try {
    const summary = await insertFakeData(db, data, { env: process.env, append: options.append });
    console.log(`넣은 행: 환자 ${summary.patients}, 예약 ${summary.appointments}, 상태 이력 ${summary.statusLogs}`);
    if (summary.skippedAppointments > 0) {
      console.log(`  기존 예약과 겹쳐 넣지 않은 예약: ${summary.skippedAppointments}`);
    }
    console.log("예약 상태별:");
    for (const status of APPOINTMENT_STATUSES) {
      const count = summary.appointmentsByStatus[status];
      if (count > 0) console.log(`  ${APPOINTMENT_STATUS_LABEL[status]} (${status})\t${count}`);
    }
    console.log(`걸린 시간: ${((Date.now() - startedAt) / 1000).toFixed(1)}초`);
  } finally {
    await db.$disconnect();
  }
}

// 명령줄에서 직접 실행했을 때만 main을 돈다(통합 테스트는 insertFakeData만 import한다).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    // Prisma 에러 메시지에는 쿼리 인자(이름·암호문 등)가 섞일 수 있어 이름·코드만 출력한다.
    if (error instanceof FakeDataError || (error instanceof TypeError && "code" in error)) {
      console.error(`가짜 데이터 넣기 실패: ${error.message}`);
    } else {
      const code = (error as { code?: unknown } | null)?.code;
      const name = error instanceof Error ? error.name : typeof error;
      console.error(`가짜 데이터 넣기 실패: ${name}${typeof code === "string" ? ` (${code})` : ""}`);
    }
    process.exitCode = 1;
  });
}
