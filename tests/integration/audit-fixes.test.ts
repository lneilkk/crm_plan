/**
 * 감사(절대 규칙 4)·예약 규칙 보완 — R1 점검에서 확인된 문제들.
 *
 * 1. 쓰기 API의 SUCCESS 감사 행은 변경과 한 트랜잭션이다. 감사 행을 쓰지 못하면 변경도 남지 않는다.
 *    (시험에서는 audit_log에 SUCCESS 행 INSERT를 거부하는 트리거를 잠시 걸어 실패를 만든다.)
 * 2. 실패한 상태 변경·되돌리기·예약변경·옮기기 시도도 감사 행에 대상 고객(patient_id)과 예약 id가 남는다.
 * 3. 지난 날의 예약은 옮길 수 없고, 날짜를 바꾸는 옮기기는 예약변경으로 보낸다. 지난 날짜로는 예약을 만들 수 없다.
 * 4. 메모에 주민등록번호 모양이 있으면 저장하지 않는다(절대 규칙 3). 응답에 값이 되돌아오지 않는다.
 * 5. 요청 본문은 64 KiB까지만 읽는다(로그인처럼 세션 없이 부르는 API 포함).
 *
 * 환자는 지어낸 이름과 배정되지 않는 010-0XXX-XXXX 번호만 쓴다(절대 규칙 1).
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CLINIC_SETTINGS } from "@/lib/domain/clinic";
import { addDays, kstDateKey, kstDateTime } from "@/lib/time/kst";
import { PATCH as moveRoute } from "@/app/api/appointments/[id]/move/route";
import { POST as rescheduleRoute } from "@/app/api/appointments/[id]/reschedule/route";
import { POST as revertRoute } from "@/app/api/appointments/[id]/revert/route";
import { POST as statusRoute } from "@/app/api/appointments/[id]/status/route";
import { POST as createAppointmentRoute } from "@/app/api/appointments/route";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { PATCH as updatePatientRoute } from "@/app/api/patients/[id]/route";
import { POST as createPatientRoute } from "@/app/api/patients/route";
import { MAX_BODY_BYTES } from "@/server/api/define-route";
import { createAppointment } from "@/server/appointments/create";
import { changeStatus } from "@/server/appointments/status";
import { sealPhone } from "@/server/crypto/pii";
import { callRoute, loginAs, TEST_ORIGIN } from "./helpers/api";
import { createPatient, db, resetDb } from "./helpers";

beforeAll(() => {
  // 키는 실행마다 새로 만든다. 저장소에는 키 문자열을 두지 않는다.
  process.env.PII_ENC_KEY = randomBytes(32).toString("base64");
  process.env.PII_HMAC_KEY = randomBytes(32).toString("base64");
});

let front: Awaited<ReturnType<typeof loginAs>>;

beforeEach(async () => {
  await resetDb();
  await db.clinicSetting.create({ data: { id: 1, ...DEFAULT_CLINIC_SETTINGS } });
  front = await loginAs("FRONT");
});

afterEach(async () => {
  await allowAuditSuccess();
});

// --- 준비 도구 ---

/** audit_log에 SUCCESS 행을 넣으려 하면 DB가 거부하게 한다(디스크·권한 오류 같은 감사 쓰기 실패 흉내). */
async function failAuditSuccess() {
  await db.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION test_reject_audit_success() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'test: audit insert rejected'; END $$;
  `);
  await db.$executeRawUnsafe(`
    CREATE TRIGGER test_reject_audit_success BEFORE INSERT ON audit_log
    FOR EACH ROW WHEN (NEW.result = 'SUCCESS') EXECUTE FUNCTION test_reject_audit_success();
  `);
}

async function allowAuditSuccess() {
  await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_reject_audit_success ON audit_log`);
  await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_reject_audit_success()`);
}

const TODAY = () => kstDateKey(new Date());
/** 모레 한국 시간 — 예약일 전(사전취소·예약변경·옮기기용) */
const future = (time: string, days = 2) => kstDateTime(addDays(TODAY(), days), time);

async function fakePatient(phone = "010-0123-4567") {
  return createPatient({ ...sealPhone(phone), visitType: "NEW", referralSource: "WEBSITE" });
}

/** 서비스로 바로 만든 예약(지난 날짜도 만들 수 있다). 첫 이력 행 포함. */
async function appointmentAt(startAt: Date, chair = "C1") {
  const patient = await fakePatient();
  const appointment = await createAppointment(
    { patientId: patient.id, startAt, durationMin: 30, chair, treatmentItem: "정기검진", channel: "PHONE" },
    { actorId: front.staff.id },
  );
  return { patient, appointment };
}

async function auditRows(action: string) {
  return db.auditLog.findMany({ where: { action }, orderBy: { createdAt: "asc" } });
}

const statusCall = (id: string, body: Record<string, unknown>) =>
  callRoute(statusRoute, { method: "POST", url: `/api/appointments/${id}/status`, cookie: front.cookie, params: { id }, body });
const revertCall = (id: string, body: Record<string, unknown>) =>
  callRoute(revertRoute, { method: "POST", url: `/api/appointments/${id}/revert`, cookie: front.cookie, params: { id }, body });
const rescheduleCall = (id: string, body: Record<string, unknown>) =>
  callRoute(rescheduleRoute, {
    method: "POST",
    url: `/api/appointments/${id}/reschedule`,
    cookie: front.cookie,
    params: { id },
    body,
  });
const moveCall = (id: string, body: Record<string, unknown>) =>
  callRoute(moveRoute, { method: "PATCH", url: `/api/appointments/${id}/move`, cookie: front.cookie, params: { id }, body });

// --- 1. 감사 행과 변경은 한 트랜잭션 ---

describe("쓰기 API — 감사 행을 쓰지 못하면 변경도 남지 않는다", () => {
  it("고객 등록: 500이고 고객 행이 없으며, 실패 행만 남는다", async () => {
    await failAuditSuccess();
    const res = await callRoute(createPatientRoute, {
      method: "POST",
      url: "/api/patients",
      cookie: front.cookie,
      body: { name: "가상등록", phone: "010-0111-2222" },
    });
    expect(res.status).toBe(500);
    expect(await db.patient.count()).toBe(0);
    expect((await auditRows("PATIENT_CREATE")).map((a) => a.result)).toEqual(["FAILED"]);
  });

  it("고객 수정: 500이고 메모가 그대로다", async () => {
    const patient = await fakePatient();
    await failAuditSuccess();
    const res = await callRoute(updatePatientRoute, {
      method: "PATCH",
      url: `/api/patients/${patient.id}`,
      cookie: front.cookie,
      params: { id: patient.id },
      body: { memo: "바뀐 메모" },
    });
    expect(res.status).toBe(500);
    expect((await db.patient.findUniqueOrThrow({ where: { id: patient.id } })).memo).toBeNull();
    const rows = await auditRows("PATIENT_UPDATE");
    expect(rows.map((a) => [a.result, a.patientId])).toEqual([["FAILED", patient.id]]);
  });

  it("예약 등록: 500이고 예약·상태 이력이 없다", async () => {
    const patient = await fakePatient();
    await failAuditSuccess();
    const res = await callRoute(createAppointmentRoute, {
      method: "POST",
      url: "/api/appointments",
      cookie: front.cookie,
      body: {
        patientId: patient.id,
        startAt: future("10:00").toISOString(),
        durationMin: 30,
        chair: "C1",
        treatmentItem: "정기검진",
        channel: "PHONE",
      },
    });
    expect(res.status).toBe(500);
    expect(await db.appointment.count()).toBe(0);
    expect(await db.visitStatusLog.count()).toBe(0);
  });

  it("옮기기: 500이고 시각이 그대로다", async () => {
    const { appointment } = await appointmentAt(future("10:00"));
    await failAuditSuccess();
    const res = await moveCall(appointment.id, { startAt: future("11:00").toISOString() });
    expect(res.status).toBe(500);
    const after = await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(after.startAt).toEqual(future("10:00"));
  });

  it("상태 변경: 500이고 상태·이력·노쇼 횟수가 그대로다", async () => {
    const { appointment } = await appointmentAt(future("10:00"));
    await failAuditSuccess();
    const res = await statusCall(appointment.id, { to: "CONFIRMED", expectedStatus: "BOOKED" });
    expect(res.status).toBe(500);
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe("BOOKED");
    expect(await db.visitStatusLog.count({ where: { appointmentId: appointment.id } })).toBe(1);
    const rows = await auditRows("VISIT_STATUS_CHANGE");
    expect(rows.map((a) => [a.result, a.patientId])).toEqual([["FAILED", appointment.patientId]]);
  });

  it("되돌리기: 500이고 상태·이력이 그대로다", async () => {
    const { appointment } = await appointmentAt(future("10:00"));
    await changeStatus({
      appointmentId: appointment.id,
      to: "CONFIRMED",
      expectedStatus: "BOOKED",
      actor: front.staff,
      now: new Date(),
    });
    await failAuditSuccess();
    const res = await revertCall(appointment.id, { expectedStatus: "CONFIRMED" });
    expect(res.status).toBe(500);
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe("CONFIRMED");
    expect(await db.visitStatusLog.count({ where: { appointmentId: appointment.id } })).toBe(2);
  });

  it("예약변경: 500이고 원 예약은 그대로, 새 예약은 없다", async () => {
    const { appointment } = await appointmentAt(future("10:00"));
    await failAuditSuccess();
    const res = await rescheduleCall(appointment.id, { startAt: future("10:00", 3).toISOString(), expectedStatus: "BOOKED" });
    expect(res.status).toBe(500);
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe("BOOKED");
    expect(await db.appointment.count()).toBe(1);
    expect(await db.visitStatusLog.count()).toBe(1);
  });

  it("감사 행을 쓸 수 있으면 변경과 SUCCESS 행이 함께 남는다", async () => {
    const { appointment } = await appointmentAt(future("10:00"));
    const res = await statusCall(appointment.id, { to: "CONFIRMED", expectedStatus: "BOOKED" });
    expect(res.status).toBe(200);
    const rows = await auditRows("VISIT_STATUS_CHANGE");
    expect(rows.map((a) => [a.result, a.patientId])).toEqual([["SUCCESS", appointment.patientId]]);
  });
});

// --- 2. 실패한 시도에도 대상 고객 ---

describe("실패한 시도의 감사 행에도 대상 고객과 예약이 남는다", () => {
  it("상태 변경 409 STATUS_CHANGED", async () => {
    const { appointment } = await appointmentAt(future("10:00"));
    const res = await statusCall(appointment.id, { to: "CONFIRMED", expectedStatus: "CONFIRMED" });
    expect(res.status).toBe(409);
    const [row] = await auditRows("VISIT_STATUS_CHANGE");
    expect(row).toMatchObject({ result: "FAILED", patientId: appointment.patientId });
    expect(row.detail).toMatchObject({ appointmentId: appointment.id, errorCode: "STATUS_CHANGED", patientCount: 1 });
  });

  it("되돌리기 409 NOTHING_TO_REVERT", async () => {
    const { appointment } = await appointmentAt(future("10:00"));
    expect((await revertCall(appointment.id, { expectedStatus: "BOOKED" })).status).toBe(409);
    const [row] = await auditRows("VISIT_STATUS_REVERT");
    expect(row).toMatchObject({ result: "FAILED", patientId: appointment.patientId });
    expect(row.detail).toMatchObject({ errorCode: "NOTHING_TO_REVERT", patientCount: 1 });
  });

  it("예약변경 400 PAST_DATE", async () => {
    const { appointment } = await appointmentAt(future("10:00"));
    const yesterday = kstDateTime(addDays(TODAY(), -1), "10:00").toISOString();
    expect((await rescheduleCall(appointment.id, { startAt: yesterday, expectedStatus: "BOOKED" })).status).toBe(400);
    const [row] = await auditRows("APPOINTMENT_RESCHEDULE");
    expect(row).toMatchObject({ result: "FAILED", patientId: appointment.patientId });
    expect(row.detail).toMatchObject({ errorCode: "PAST_DATE" });
  });

  it("옮기기 409 CHAIR_CONFLICT — 예약 id와 고객이 남는다", async () => {
    const { appointment } = await appointmentAt(future("10:00"), "C1");
    await appointmentAt(future("11:00"), "C1");
    expect((await moveCall(appointment.id, { startAt: future("11:00").toISOString() })).status).toBe(409);
    const [row] = await auditRows("APPOINTMENT_MOVE");
    expect(row).toMatchObject({ result: "FAILED", patientId: appointment.patientId });
    expect(row.detail).toMatchObject({ appointmentId: appointment.id, errorCode: "CHAIR_CONFLICT" });
  });

  it("없는 예약은 404, 고객은 비어 있고 예약 id는 남는다", async () => {
    const id = "0190f0f0-0000-7000-8000-000000000000";
    expect((await moveCall(id, { startAt: future("11:00").toISOString() })).status).toBe(404);
    const [row] = await auditRows("APPOINTMENT_MOVE");
    expect(row).toMatchObject({ result: "FAILED", patientId: null });
    expect(row.detail).toMatchObject({ appointmentId: id, errorCode: "NOT_FOUND", patientCount: 0 });
  });
});

// --- 3. 날짜 규칙 ---

describe("옮기기·예약 등록의 날짜 규칙", () => {
  it("지난 날의 미처리 예약은 오늘로 옮길 수 없다 — 409 PAST_APPOINTMENT, 그대로 남는다", async () => {
    const yesterday = kstDateTime(addDays(TODAY(), -1), "10:00");
    const { appointment } = await appointmentAt(yesterday);
    const res = await moveCall(appointment.id, { startAt: kstDateTime(TODAY(), "23:00").toISOString() });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("PAST_APPOINTMENT");
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).startAt).toEqual(yesterday);
  });

  it("다른 날로 옮기기는 예약변경으로 보낸다 — 400 USE_RESCHEDULE", async () => {
    const { appointment } = await appointmentAt(future("10:00"));
    const res = await moveCall(appointment.id, { startAt: future("10:00", 3).toISOString() });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("USE_RESCHEDULE");
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).startAt).toEqual(future("10:00"));
  });

  it("같은 날 안의 옮기기는 된다", async () => {
    const { appointment } = await appointmentAt(future("10:00"));
    expect((await moveCall(appointment.id, { startAt: future("15:00").toISOString() })).status).toBe(200);
  });

  it("지난 날짜로는 예약을 만들 수 없다 — 400 PAST_DATE. 오늘은 지난 시각이어도 된다", async () => {
    const patient = await fakePatient();
    const payload = (startAt: Date) => ({
      patientId: patient.id,
      startAt: startAt.toISOString(),
      durationMin: 30,
      chair: "C2",
      treatmentItem: "정기검진",
      channel: "PHONE",
    });
    const call = (startAt: Date) =>
      callRoute(createAppointmentRoute, { method: "POST", url: "/api/appointments", cookie: front.cookie, body: payload(startAt) });

    const past = await call(kstDateTime(addDays(TODAY(), -7), "10:00"));
    expect(past.status).toBe(400);
    expect(past.json.error.code).toBe("PAST_DATE");
    expect(await db.appointment.count()).toBe(0);

    expect((await call(kstDateTime(TODAY(), "00:00"))).status).toBe(201);
  });
});

// --- 4. 메모의 주민등록번호 ---

describe("메모에 주민등록번호 모양이 있으면 저장하지 않는다", () => {
  // 지어낸 모양뿐인 값(실제 번호 아님)
  const RRN_LIKE = "900101-1234567";

  it("고객 등록 메모 — 400, 필드 경로만 돌려주고 값은 응답에 없다", async () => {
    const res = await callRoute(createPatientRoute, {
      method: "POST",
      url: "/api/patients",
      cookie: front.cookie,
      body: { name: "가상메모", phone: "010-0111-3333", memo: `확인 ${RRN_LIKE}` },
    });
    expect(res.status).toBe(400);
    expect(res.json.error.fields).toEqual([{ path: "memo", code: "custom" }]);
    expect(res.text).not.toContain("1234567");
    expect(await db.patient.count()).toBe(0);
  });

  it("고객 수정 메모 — 400", async () => {
    const patient = await fakePatient();
    const res = await callRoute(updatePatientRoute, {
      method: "PATCH",
      url: `/api/patients/${patient.id}`,
      cookie: front.cookie,
      params: { id: patient.id },
      body: { memo: RRN_LIKE.replace("-", "") },
    });
    expect(res.status).toBe(400);
    expect((await db.patient.findUniqueOrThrow({ where: { id: patient.id } })).memo).toBeNull();
  });

  it("예약 메모 — 400", async () => {
    const patient = await fakePatient();
    const res = await callRoute(createAppointmentRoute, {
      method: "POST",
      url: "/api/appointments",
      cookie: front.cookie,
      body: {
        patientId: patient.id,
        startAt: future("10:00").toISOString(),
        durationMin: 30,
        chair: "C1",
        treatmentItem: "정기검진",
        channel: "PHONE",
        memo: RRN_LIKE,
      },
    });
    expect(res.status).toBe(400);
    expect(res.json.error.fields).toEqual([{ path: "memo", code: "custom" }]);
    expect(await db.appointment.count()).toBe(0);
  });
});

// --- 5. 본문 크기 상한 ---

describe("요청 본문 상한", () => {
  function loginRequest(body: BodyInit, headers: Record<string, string> = {}) {
    return new Request(new URL("/api/auth/login", TEST_ORIGIN), {
      method: "POST",
      headers: { origin: TEST_ORIGIN, "content-type": "application/json", ...headers },
      body,
      // ReadableStream 본문에 필요하다(Node fetch).
      ...({ duplex: "half" } as object),
    });
  }

  it("Content-Length가 상한을 넘으면 읽지 않고 413", async () => {
    const big = JSON.stringify({ loginId: "x", password: "a".repeat(MAX_BODY_BYTES) });
    const res = await loginRoute(loginRequest(big, { "content-length": String(big.length) }));
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(await db.auditLog.count()).toBe(0);
  });

  it("길이를 알리지 않은 본문도 상한에서 멈추고 413", async () => {
    let pulled = 0;
    const chunk = new TextEncoder().encode("a".repeat(16 * 1024));
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 1000) controller.close(); // 16 MB에서 끝나지만 그 전에 멈춰야 한다
        else controller.enqueue(chunk);
      },
    });
    const res = await loginRoute(loginRequest(stream));
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(10);
  });
});
