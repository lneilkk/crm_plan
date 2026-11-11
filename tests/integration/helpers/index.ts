/**
 * 통합 테스트 공용 도구 — DB 비우기와 테스트 데이터 생성.
 *
 * 테스트 데이터는 모두 가짜다(절대 규칙 1). 암호화 모듈(src/server/crypto)에 의존하지 않도록
 * phone_enc와 해시 컬럼에는 누가 봐도 자리표시자인 문자열을 넣는다.
 * 실제 암호문·해시가 필요한 테스트는 값을 만들어 overrides로 넘긴다.
 */
import type { Prisma } from "@/generated/prisma/client";
import { kstDateTime } from "@/lib/time/kst";
import { db } from "@/server/db";
import { assertTestDatabaseUrl } from "../support/test-db";

export { db };

let sequence = 0;

/** 테스트 실행 안에서 겹치지 않는 번호 (unique 컬럼용) */
export function nextSeq(): number {
  sequence += 1;
  return sequence;
}

/**
 * 모든 테이블을 비운다. 테스트마다 beforeEach에서 부른다.
 * TRUNCATE는 추가 전용 테이블(visit_status_log, audit_log)도 비우지만,
 * 버리는 임시 DB에서만 도는 테스트 코드라 괜찮다. 앱 코드에서는 절대 쓰지 않는다.
 */
export async function resetDb(): Promise<void> {
  assertTestDatabaseUrl(process.env.DATABASE_URL);
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map(({ tablename }) => `"public"."${tablename.replaceAll('"', '""')}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export function createStaff(overrides: Partial<Prisma.StaffUncheckedCreateInput> = {}) {
  return db.staff.create({
    data: {
      loginId: `test-staff-${nextSeq()}`,
      name: "테스트직원",
      role: "FRONT",
      passwordHash: "test-placeholder-not-a-password-hash",
      ...overrides,
    },
  });
}

export function createPatient(overrides: Partial<Prisma.PatientUncheckedCreateInput> = {}) {
  const n = nextSeq();
  return db.patient.create({
    data: {
      name: `가상환자${n}`,
      phoneEnc: "test-placeholder-phone-enc",
      phoneHash: `test-placeholder-phone-hash-${n}`,
      phoneLast4Hash: "test-placeholder-phone-last4-hash",
      ...overrides,
    },
  });
}

/** 기본 예약 시각: 2026-11-12(목) 한국 시간 10:00 */
export const DEFAULT_APPOINTMENT_START = kstDateTime("2026-11-12", "10:00");

type AppointmentOverrides = Partial<Omit<Prisma.AppointmentUncheckedCreateInput, "startAt" | "endAt">> & {
  startAt?: Date;
  /** 일부러 틀린 종료 시각을 넣어 보는 테스트용. 보통은 비워 두면 start_at + duration_min으로 계산한다. */
  endAt?: Date;
};

/**
 * 예약 한 건을 만든다. patientId를 주지 않으면 환자도 새로 만든다.
 * 상태 이력(visit_status_log) 첫 행은 쓰지 않는다 — 그건 예약 서비스(T3-x)의 일이다.
 */
export async function createAppointment(overrides: AppointmentOverrides = {}) {
  const patientId = overrides.patientId ?? (await createPatient()).id;
  const startAt = overrides.startAt ?? DEFAULT_APPOINTMENT_START;
  const durationMin = overrides.durationMin ?? 30;
  return db.appointment.create({
    data: {
      chair: "C1",
      treatmentItem: "정기검진",
      channel: "PHONE",
      ...overrides,
      patientId,
      startAt,
      durationMin,
      endAt: overrides.endAt ?? new Date(startAt.getTime() + durationMin * 60_000),
    },
  });
}

/** Prisma(드라이버 어댑터)가 감싼 PostgreSQL 에러에서 SQLSTATE 코드와 메시지를 꺼낸다. */
export function postgresErrorOf(error: unknown): { code?: string; message?: string } {
  const cause = (error as { meta?: { driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } } } })
    ?.meta?.driverAdapterError?.cause;
  return { code: cause?.originalCode, message: cause?.originalMessage };
}

/** 작업이 지정한 DB 제약 위반(SQLSTATE 코드 + 제약 이름)으로 거부되는지 확인한다. */
export async function expectConstraintViolation(work: Promise<unknown>, code: string, constraint: string) {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (error === null) throw new Error(`제약 ${constraint} 위반을 기대했지만 성공했다`);
  const pgError = postgresErrorOf(error);
  if (pgError.code !== code || !pgError.message?.includes(`"${constraint}"`)) {
    throw new Error(`제약 ${constraint}(${code}) 위반을 기대했지만 다른 에러가 났다: ${pgError.code ?? String(error)}`);
  }
}
