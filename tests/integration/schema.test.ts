/**
 * T1-1 완료 기준 — 스키마가 기획서 6장 필드와 일치하고, 주민번호·진료기록 필드가 없으며,
 * (피드백 F-2로 예약 색 라벨 테이블 2개와 clinic_setting.status_styles를 더했다.)
 * Prisma로 표현할 수 없어 마이그레이션 SQL에 직접 넣은 제약이 실제로 동작하는지 확인한다.
 */
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppointmentStatus } from "@/lib/domain/appointment";
import { SLOT_HOLDING_STATUSES } from "@/lib/domain/appointment";
import { kstDateTime } from "@/lib/time/kst";
import {
  createAppointment,
  createPatient,
  createStaff,
  db,
  expectConstraintViolation,
  postgresErrorOf,
  resetDb,
} from "./helpers";

const EXCLUSION_VIOLATION = "23P01";
const CHECK_VIOLATION = "23514";
// ON DELETE RESTRICT 위반도 PostgreSQL은 foreign_key_violation(23503)으로 알린다.
const FOREIGN_KEY_VIOLATION = "23503";

/** 기획서 6장 + T1-1 설계에서 정한 테이블별 컬럼 */
const EXPECTED_COLUMNS: Record<string, string[]> = {
  patient: [
    "id",
    "name",
    "phone_enc",
    "phone_hash",
    "phone_last4_hash",
    "birth_date_enc",
    "gender",
    "visit_type",
    "referral_source",
    "tags",
    "no_show_count",
    "dentweb_chart_no",
    "memo",
    "created_by_id",
    "created_at",
    "updated_at",
  ],
  consent: ["id", "patient_id", "type", "agreed", "agreed_at", "withdrawn_at", "recorded_by_id", "created_at"],
  staff: [
    "id",
    "login_id",
    "name",
    "role",
    "branch",
    "password_hash",
    "failed_login_count",
    "locked_at",
    "is_active",
    "last_login_at",
    "created_at",
    "updated_at",
  ],
  session: [
    "id",
    "token_hash",
    "staff_id",
    "created_at",
    "last_seen_at",
    "expires_at",
    "revoked_at",
    "ip",
    "user_agent",
  ],
  appointment: [
    "id",
    "patient_id",
    "start_at",
    "duration_min",
    "end_at",
    "doctor_id",
    "counselor_id",
    "chair",
    "treatment_item",
    "channel",
    "status",
    "arrived_at",
    "original_appointment_id",
    "memo",
    // F-6(피드백): 등록·항목 변경 시점 단가와 할인율
    "list_price",
    "discount_rate",
    "created_by_id",
    "created_at",
    "updated_at",
  ],
  visit_status_log: [
    "id",
    "appointment_id",
    "from_status",
    "to_status",
    "reason_code",
    "staff_id",
    "created_at",
    "input_device",
  ],
  consultation: [
    "id",
    "patient_id",
    "counselor_id",
    "content",
    "interested_items",
    "result",
    // F-10(피드백): 상담 결과 분류 이름, 상담 시점 신환 여부
    "outcome",
    "is_new_patient",
    "appointment_id",
    "consulted_at",
    "created_at",
    "updated_at",
  ],
  clinic_setting: [
    "id",
    "late_tolerance_min",
    "no_show_grace_min",
    "business_hours",
    "chairs",
    "treatment_items",
    // F-2(피드백): 예약 상태별 캘린더 표시 이름·색. 기획서 6장에는 없다(CHECKLIST F-2 메모).
    "status_styles",
    // F-5·F-6(피드백): 예약 항목별 구분(고가·일반)·단가
    "treatment_item_meta",
    // F-10(피드백): 상담 결과 분류 목록
    "consult_outcomes",
    "updated_by_id",
    "updated_at",
  ],
  audit_log: ["id", "staff_id", "action", "patient_id", "ip", "user_agent", "result", "detail", "created_at"],
  // F-2(피드백): 예약 색 라벨 목록과 예약 ↔ 라벨 연결. 기획서 6장에는 없다(CHECKLIST F-2 메모).
  appointment_label: ["id", "name", "color", "sort_order", "is_active", "created_at", "updated_at"],
  appointment_label_link: ["appointment_id", "label_id", "created_at"],
};

/** 주민등록번호·진료기록(진단·처방)을 떠올리게 하는 이름 (절대 규칙 3) */
const FORBIDDEN_NAME_RE =
  /resident|rrn|jumin|ssn|social_?sec|national_?id|주민|diagnos|prescri|medical|clinical|disease|symptom|medication|drug|진단|처방|진료기록/i;

const FREEING_STATUSES = ["NO_SHOW", "CANCELED_SAME_DAY", "CANCELED_ADVANCE", "RESCHEDULED"] as const;

async function columnsOf(table: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
  `;
  return rows.map((row) => row.column_name).sort();
}

beforeEach(async () => {
  await resetDb();
});

describe("테이블과 컬럼 (기획서 6장)", () => {
  it("테이블은 정해진 것뿐이다: 기획서 6장의 9개 + 피드백 F-2의 2개 (Prisma 마이그레이션 기록 테이블 제외)", async () => {
    const rows = await db.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'
    `;
    expect(rows.map((row) => row.table_name).sort()).toEqual(Object.keys(EXPECTED_COLUMNS).sort());
  });

  it.each(Object.entries(EXPECTED_COLUMNS))("%s 테이블의 컬럼이 설계와 정확히 같다", async (table, columns) => {
    expect(await columnsOf(table)).toEqual([...columns].sort());
  });

  it("주민등록번호·진료기록(진단·처방)을 떠올리게 하는 테이블·컬럼이 없다", async () => {
    const rows = await db.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'
    `;
    expect(rows.length).toBeGreaterThan(0);
    const suspicious = rows.filter(
      (row) => FORBIDDEN_NAME_RE.test(row.table_name) || FORBIDDEN_NAME_RE.test(row.column_name),
    );
    expect(suspicious).toEqual([]);
  });

  it("감사 로그에는 외래 키가 없다 (가리키는 행이 없어져도 로그는 그대로 남아야 한다)", async () => {
    const rows = await db.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint WHERE conrelid = 'public.audit_log'::regclass AND contype = 'f'
    `;
    expect(rows).toEqual([]);
  });

  // 이력 테이블(내원 상태 이력·동의)은 행을 고치지 않는다. 외래 키 동작(SET NULL·CASCADE)도
  // 이력 행을 UPDATE하므로, 삭제·수정 모두 RESTRICT여야 한다.
  it.each([
    [
      "visit_status_log",
      ["visit_status_log_appointment_id_fkey", "visit_status_log_staff_id_fkey"],
    ],
    ["consent", ["consent_patient_id_fkey", "consent_recorded_by_id_fkey"]],
  ])("이력 테이블 %s의 외래 키는 삭제·수정을 막는다 (ON DELETE/UPDATE RESTRICT)", async (table, names) => {
    const rows = await db.$queryRaw<{ conname: string; confdeltype: string; confupdtype: string }[]>`
      SELECT conname, confdeltype::text AS confdeltype, confupdtype::text AS confupdtype
      FROM pg_constraint
      WHERE conrelid = ${`public.${table}`}::regclass AND contype = 'f'
      ORDER BY conname
    `;
    expect(rows).toEqual(names.map((conname) => ({ conname, confdeltype: "r", confupdtype: "r" })));
  });

  it("동의 기록을 남긴 직원은 삭제할 수 없다 (동의 이력 행이 SET NULL로 바뀌지 않는다)", async () => {
    const staff = await createStaff();
    const patient = await createPatient();
    await db.consent.create({
      data: { patientId: patient.id, type: "PRIVACY", agreed: true, recordedById: staff.id },
    });
    await expectConstraintViolation(
      db.$executeRaw`DELETE FROM staff WHERE id = ${staff.id}::uuid`,
      FOREIGN_KEY_VIOLATION,
      "consent_recorded_by_id_fkey",
    );
    const [consent] = await db.consent.findMany({ where: { patientId: patient.id } });
    expect(consent.recordedById).toBe(staff.id);
  });

  it("가족이 같은 번호를 쓸 수 있으므로 phone_hash는 unique가 아니다", async () => {
    await createPatient({ phoneHash: "test-placeholder-shared-hash" });
    await createPatient({ phoneHash: "test-placeholder-shared-hash" });
    expect(await db.patient.count({ where: { phoneHash: "test-placeholder-shared-hash" } })).toBe(2);
  });

  it("id는 UUID v7이다", async () => {
    const staff = await createStaff();
    expect(staff.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("같은 체어·겹치는 시간 예약 금지 (appointment_no_chair_overlap)", () => {
  const ten = kstDateTime("2026-11-12", "10:00");
  const tenFifteen = kstDateTime("2026-11-12", "10:15");
  const tenThirty = kstDateTime("2026-11-12", "10:30");
  const nineThirty = kstDateTime("2026-11-12", "09:30");

  it.each(SLOT_HOLDING_STATUSES)("기존 예약이 %s이면 겹치는 예약을 거부한다", async (status: AppointmentStatus) => {
    const existing = await createAppointment({ startAt: ten, durationMin: 30, status });
    await expectConstraintViolation(
      createAppointment({ patientId: existing.patientId, startAt: tenFifteen, durationMin: 30 }),
      EXCLUSION_VIOLATION,
      "appointment_no_chair_overlap",
    );
  });

  it("시간이 완전히 같은 예약도 거부한다", async () => {
    await createAppointment({ startAt: ten, durationMin: 30 });
    await expectConstraintViolation(
      createAppointment({ startAt: ten, durationMin: 30 }),
      EXCLUSION_VIOLATION,
      "appointment_no_chair_overlap",
    );
  });

  it("앞 예약이 끝나는 시각에 시작하는 예약은 받는다 (끝 시각 미포함)", async () => {
    await createAppointment({ startAt: ten, durationMin: 30 });
    await createAppointment({ startAt: tenThirty, durationMin: 30 });
    await createAppointment({ startAt: nineThirty, durationMin: 30 });
    expect(await db.appointment.count({ where: { chair: "C1" } })).toBe(3);
  });

  it("다른 체어라면 같은 시간도 받는다", async () => {
    await createAppointment({ startAt: ten, durationMin: 30, chair: "C1" });
    await createAppointment({ startAt: ten, durationMin: 30, chair: "C2" });
    expect(await db.appointment.count()).toBe(2);
  });

  it.each(FREEING_STATUSES)("기존 예약이 %s이면 자리가 비었으므로 겹치는 예약을 받는다", async (status) => {
    await createAppointment({ startAt: ten, durationMin: 30, status });
    await createAppointment({ startAt: tenFifteen, durationMin: 30 });
    expect(await db.appointment.count()).toBe(2);
  });

  it("자리를 비운 예약을 다시 자리 차지 상태로 바꾸면 겹칠 때 거부한다", async () => {
    const canceled = await createAppointment({ startAt: ten, durationMin: 30, status: "CANCELED_ADVANCE" });
    await createAppointment({ startAt: ten, durationMin: 30 });
    await expectConstraintViolation(
      db.appointment.update({ where: { id: canceled.id }, data: { status: "BOOKED" } }),
      EXCLUSION_VIOLATION,
      "appointment_no_chair_overlap",
    );
  });

  describe("동시에 같은 자리를 잡는 두 트랜잭션", () => {
    const clients: pg.Client[] = [];

    afterEach(async () => {
      await Promise.all(clients.splice(0).map((client) => client.end().catch(() => {})));
    });

    async function connect(): Promise<pg.Client> {
      const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
      clients.push(client);
      await client.connect();
      return client;
    }

    it("정확히 하나만 성공한다", async () => {
      const patient = await createPatient();
      const insert = `
        INSERT INTO appointment (id, patient_id, start_at, duration_min, end_at, chair, treatment_item, channel)
        VALUES (gen_random_uuid(), $1, $2, 30, $2::timestamptz + interval '30 minutes', 'C1', '정기검진', 'PHONE')
      `;
      const first = await connect();
      const second = await connect();
      const { rows } = await second.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const secondPid = rows[0].pid;

      await first.query("BEGIN");
      await second.query("BEGIN");
      await first.query(insert, [patient.id, ten]);
      // 두 번째 INSERT는 첫 번째 트랜잭션이 끝날 때까지 기다린다.
      const secondInsert = second.query(insert, [patient.id, ten]).then(
        () => null,
        (error: unknown) => error,
      );

      // 두 번째 연결이 실제로 잠금 대기에 들어간 것을 확인한 뒤 첫 번째를 커밋한다.
      await expect
        .poll(
          async () => {
            const waiting = await db.$queryRaw<{ wait_event_type: string | null }[]>`
              SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${secondPid}
            `;
            return waiting[0]?.wait_event_type;
          },
          { timeout: 5000, interval: 50 },
        )
        .toBe("Lock");
      await first.query("COMMIT");

      const secondError = (await secondInsert) as { code?: string; constraint?: string } | null;
      await second.query("ROLLBACK");
      expect(secondError?.code).toBe(EXCLUSION_VIOLATION);
      expect(secondError?.constraint).toBe("appointment_no_chair_overlap");
      expect(await db.appointment.count()).toBe(1);
    });
  });
});

describe("CHECK 제약", () => {
  const ten = kstDateTime("2026-11-12", "10:00");

  it("end_at이 start_at + duration_min과 다르면 거부한다", async () => {
    await expectConstraintViolation(
      createAppointment({ startAt: ten, durationMin: 30, endAt: kstDateTime("2026-11-12", "10:45") }),
      CHECK_VIOLATION,
      "appointment_end_at_check",
    );
  });

  it.each([0, 4, 481, -30])("소요시간 %i분은 거부한다 (5~480분)", async (durationMin) => {
    await expectConstraintViolation(
      createAppointment({ startAt: ten, durationMin }),
      CHECK_VIOLATION,
      "appointment_duration_min_check",
    );
  });

  it("소요시간 5분과 480분은 받는다", async () => {
    await createAppointment({ startAt: ten, durationMin: 5, chair: "C1" });
    await createAppointment({ startAt: ten, durationMin: 480, chair: "C2" });
    expect(await db.appointment.count()).toBe(2);
  });

  it("병원 설정은 id = 1인 한 행만 둘 수 있다", async () => {
    const value = { businessHours: {}, chairs: [], treatmentItems: [] };
    await db.clinicSetting.create({ data: value });
    await expectConstraintViolation(
      db.clinicSetting.create({ data: { ...value, id: 2 } }),
      CHECK_VIOLATION,
      "clinic_setting_single_row_check",
    );
    const duplicate = await db.clinicSetting.create({ data: { ...value, id: 1 } }).catch((error: unknown) => error);
    expect(postgresErrorOf(duplicate).code ?? (duplicate as { code?: string }).code).toMatch(/^(23505|P2002)$/);
    expect(await db.clinicSetting.count()).toBe(1);
  });

  it("노쇼 누적 횟수는 음수가 될 수 없다", async () => {
    await expectConstraintViolation(
      createPatient({ noShowCount: -1 }),
      CHECK_VIOLATION,
      "patient_no_show_count_check",
    );
  });
});
