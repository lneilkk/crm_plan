/**
 * T5-2 상태 변경 API — 완료 기준: 로그 없이 상태만 바뀌는 경우가 없음을 테스트로 증명.
 *
 * - 허용된 모든 전환(STATUS_TRANSITIONS 표 전체)을 API로 실행해 상태와 이력 한 행이 함께 생기는지 본다.
 * - 거부되는 모든 경우에 예약 행·이력 수·노쇼 횟수가 그대로인지 본다.
 * - 이력 쓰기를 일부러 실패시켜 상태도 바뀌지 않는지(한 트랜잭션) 본다.
 * - 테스트마다 끝에 DB 전체에서 "예약의 상태 = 최신 이력의 새 상태"를 검사한다.
 * - src/ 안에서 appointment.status를 쓰는 코드가 정해진 파일에만 있는지 검사한다.
 *
 * API는 서버 시각(ctx.now = 실제 지금)을 쓰므로, API 테스트의 예약 시각은 지금을 기준으로 잡는다.
 * 시각 경계(유예시간·지각 허용시간)는 changeStatus를 고정 시각으로 직접 불러 확인한다.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  APPOINTMENT_STATUSES,
  REASON_REQUIRED_STATUSES,
  type AppointmentStatus,
  type VisitReasonCode,
} from "@/lib/domain/appointment";
import { DEFAULT_CLINIC_SETTINGS } from "@/lib/domain/clinic";
import { addDays, kstDateKey, kstDateTime } from "@/lib/time/kst";
import { STATUS_TRANSITIONS } from "@/lib/visit/transitions";
import { POST as rescheduleRoute } from "@/app/api/appointments/[id]/reschedule/route";
import { POST as revertRoute } from "@/app/api/appointments/[id]/revert/route";
import { POST as statusRoute } from "@/app/api/appointments/[id]/status/route";
import { createAppointment } from "@/server/appointments/create";
import { changeStatus } from "@/server/appointments/status";
import { callRoute, loginAs } from "./helpers/api";
import { createPatient, db, resetDb } from "./helpers";

const MINUTE = 60_000;
const CHAIRS = DEFAULT_CLINIC_SETTINGS.chairs.map((chair) => chair.code);

let front: Awaited<ReturnType<typeof loginAs>>;
let slot = 0;

beforeEach(async () => {
  await resetDb();
  slot = 0;
  await db.clinicSetting.create({ data: { id: 1, ...DEFAULT_CLINIC_SETTINGS } });
  front = await loginAs("FRONT");
});

// 테스트가 무엇을 했든, 끝난 뒤 DB 전체에서 상태 = 최신 이력의 새 상태여야 한다.
afterEach(async () => {
  const mismatches = await db.$queryRaw<{ id: string }[]>`
    SELECT a.id FROM "appointment" a
    LEFT JOIN LATERAL (
      SELECT l.to_status FROM "visit_status_log" l
      WHERE l.appointment_id = a.id
      ORDER BY l.created_at DESC
      LIMIT 1
    ) latest ON true
    WHERE latest.to_status IS NULL OR latest.to_status <> a.status
  `;
  expect(mismatches).toEqual([]);
});

// --- 준비 도구 ---

/** 5분 단위로 내린 시각 */
function floorToSlot(instant: Date): Date {
  return new Date(Math.floor(instant.getTime() / (5 * MINUTE)) * 5 * MINUTE);
}

/**
 * 겹치지 않는 예약 자리. past: 지금보다 2시간 이상 전(노쇼 유예시간이 지났고 당일 이후),
 * future: 모레 이후(예약일 전 — 사전취소·예약변경용).
 */
function nextSlot(when: "past" | "future"): { startAt: Date; chair: string } {
  const k = slot++;
  const chair = CHAIRS[k % CHAIRS.length];
  const offset = Math.floor(k / CHAIRS.length) * 30 * MINUTE;
  if (when === "past") return { chair, startAt: new Date(floorToSlot(new Date()).getTime() - 120 * MINUTE - offset) };
  const base = kstDateTime(addDays(kstDateKey(new Date()), 2), "09:30");
  return { chair, startAt: new Date(base.getTime() + offset) };
}

/** 예약 서비스로 예약을 만든다 (예약 행 + 첫 이력 null → BOOKED) */
async function book(at: { startAt: Date; chair: string }) {
  const patient = await createPatient();
  return createAppointment(
    { patientId: patient.id, startAt: at.startAt, durationMin: 30, chair: at.chair, treatmentItem: "정기검진", channel: "PHONE" },
    { actorId: front.staff.id },
  );
}

type StatusBody = { to: AppointmentStatus; expectedStatus: AppointmentStatus; reasonCode?: VisitReasonCode | null };

function postStatus(id: string, body: StatusBody, cookie = front.cookie, headers?: Record<string, string>) {
  return callRoute(statusRoute, {
    method: "POST",
    url: `/api/appointments/${id}/status`,
    cookie,
    params: { id },
    body,
    headers,
  });
}

function postRevert(id: string, expectedStatus: AppointmentStatus, cookie = front.cookie, headers?: Record<string, string>) {
  return callRoute(revertRoute, {
    method: "POST",
    url: `/api/appointments/${id}/revert`,
    cookie,
    params: { id },
    body: { expectedStatus },
    headers,
  });
}

function postReschedule(id: string, body: Record<string, unknown>, cookie = front.cookie, headers?: Record<string, string>) {
  return callRoute(rescheduleRoute, {
    method: "POST",
    url: `/api/appointments/${id}/reschedule`,
    cookie,
    params: { id },
    body,
    headers,
  });
}

/** 예약변경으로 옮길 자리: 일주일 뒤 같은 체어 */
function weekLater(startAt: Date): string {
  return new Date(startAt.getTime() + 7 * 24 * 60 * MINUTE).toISOString();
}

/** BOOKED에서 각 상태까지 가는 허용된 길 (API로 밟는다) */
const PATH_FROM_BOOKED: Record<AppointmentStatus, AppointmentStatus[]> = {
  BOOKED: [],
  CONFIRMED: ["CONFIRMED"],
  ARRIVED: ["ARRIVED"],
  NO_SHOW: ["NO_SHOW"],
  CANCELED_SAME_DAY: ["CANCELED_SAME_DAY"],
  CANCELED_ADVANCE: ["CANCELED_ADVANCE"],
  RESCHEDULED: ["RESCHEDULED"],
  IN_TREATMENT: ["ARRIVED", "IN_TREATMENT"],
  PAID: ["ARRIVED", "IN_TREATMENT", "PAID"],
  LEFT: ["ARRIVED", "IN_TREATMENT", "PAID", "LEFT"],
};

/** 사전취소는 예약일 전에만 갈 수 있고, 나머지는 예약 시각이 지난 예약에서 만든다 */
function slotKindFor(from: AppointmentStatus, to?: AppointmentStatus): "past" | "future" {
  return from === "CANCELED_ADVANCE" || to === "CANCELED_ADVANCE" ? "future" : "past";
}

/** 새 예약을 만들어 API로 from 상태까지 옮긴다 */
async function appointmentIn(from: AppointmentStatus, kind: "past" | "future" = slotKindFor(from)) {
  const appointment = await book(nextSlot(kind));
  let current: AppointmentStatus = "BOOKED";
  for (const to of PATH_FROM_BOOKED[from]) {
    const res =
      to === "RESCHEDULED"
        ? await postReschedule(appointment.id, { startAt: weekLater(appointment.startAt), expectedStatus: current })
        : await postStatus(appointment.id, { to, expectedStatus: current, reasonCode: "NO_CONTACT" });
    expect(res.status, `${current} → ${to} 준비`).toBe(200);
    current = to;
  }
  return appointment;
}

/** 거부 전후 비교용: 예약 행 전체, 이력 수, 노쇼 횟수 */
async function snapshot(appointmentId: string) {
  const appointment = await db.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
  const patient = await db.patient.findUniqueOrThrow({ where: { id: appointment.patientId } });
  return {
    appointment,
    noShowCount: patient.noShowCount,
    logCount: await db.visitStatusLog.count({ where: { appointmentId } }),
    totalLogCount: await db.visitStatusLog.count(),
    appointmentCount: await db.appointment.count(),
  };
}

async function logsOf(appointmentId: string) {
  return db.visitStatusLog.findMany({ where: { appointmentId }, orderBy: { createdAt: "asc" } });
}

const ALLOWED_PAIRS = APPOINTMENT_STATUSES.flatMap((from) => STATUS_TRANSITIONS[from].map((to) => [from, to] as const));
const NEEDS_REASON = (status: AppointmentStatus) => (REASON_REQUIRED_STATUSES as readonly AppointmentStatus[]).includes(status);

// --- 허용된 전환 ---

describe("허용된 모든 전환: 상태와 이력 한 행이 함께 바뀐다", () => {
  it("전환 표가 비어 있지 않다", () => {
    expect(ALLOWED_PAIRS.length).toBeGreaterThan(20);
  });

  it.each(ALLOWED_PAIRS)("%s → %s", async (from, to) => {
    const appointment = await appointmentIn(from, slotKindFor(from, to));
    const before = await snapshot(appointment.id);
    expect(before.appointment.status).toBe(from);

    // 예약변경은 새 예약을 함께 만드는 전용 API로
    const res =
      to === "RESCHEDULED"
        ? await postReschedule(appointment.id, { startAt: weekLater(appointment.startAt), expectedStatus: from }, front.cookie, {
            "x-input-device": "front-pc-1",
          })
        : await postStatus(appointment.id, { to, expectedStatus: from, reasonCode: "PERSONAL" }, front.cookie, {
            "x-input-device": "front-pc-1",
          });
    expect(res.status).toBe(200);
    if (to !== "RESCHEDULED") expect(res.json.appointment).toMatchObject({ id: appointment.id, status: to });

    const after = await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(after.status).toBe(to);

    const newLogs = await db.visitStatusLog.findMany({
      where: { appointmentId: appointment.id },
      orderBy: { createdAt: "asc" },
      skip: before.logCount,
    });
    expect(newLogs).toHaveLength(1);
    expect(newLogs[0]).toMatchObject({
      fromStatus: from,
      toStatus: to,
      staffId: front.staff.id,
      // 사유는 노쇼·당일취소에만 남는다
      reasonCode: NEEDS_REASON(to) ? "PERSONAL" : null,
      inputDevice: "front-pc-1",
    });
    // 예약변경만 새 예약의 첫 이력(null → 예약확정)이 하나 더 생긴다
    expect(await db.visitStatusLog.count()).toBe(before.totalLogCount + (to === "RESCHEDULED" ? 2 : 1));

    // 감사 행 (환자 한 명)
    const action = to === "RESCHEDULED" ? "APPOINTMENT_RESCHEDULE" : "VISIT_STATUS_CHANGE";
    const audit = await db.auditLog.findFirst({ where: { action }, orderBy: { createdAt: "desc" } });
    expect(audit).toMatchObject({ result: "SUCCESS", staffId: front.staff.id, patientId: appointment.patientId });
  });
});

// --- 거부 ---

async function expectRejectedUnchanged(
  appointmentId: string,
  work: () => Promise<{ status: number; json: { error?: { code: string } } }>,
  status: number,
  code: string,
) {
  const before = await snapshot(appointmentId);
  const res = await work();
  expect(res.status).toBe(status);
  expect(res.json.error?.code).toBe(code);
  expect(await snapshot(appointmentId)).toEqual(before);
}

describe("거부되면 예약 행과 이력이 그대로다", () => {
  it.each(APPOINTMENT_STATUSES)("%s에서 표에 없는 모든 전환은 409 NOT_ALLOWED", async (from) => {
    const appointment = await appointmentIn(from);
    const rejected = APPOINTMENT_STATUSES.filter((to) => !STATUS_TRANSITIONS[from].includes(to) && to !== "RESCHEDULED");
    if (from !== "RESCHEDULED") expect(rejected).toContain(from); // 같은 상태로의 전환도 거부
    for (const to of rejected) {
      await expectRejectedUnchanged(
        appointment.id,
        () => postStatus(appointment.id, { to, expectedStatus: from, reasonCode: "OTHER" }),
        409,
        "NOT_ALLOWED",
      );
    }
  });

  it.each(APPOINTMENT_STATUSES)("%s에서 상태 API로 예약변경은 400 USE_RESCHEDULE (전용 API만)", async (from) => {
    const appointment = await appointmentIn(from);
    await expectRejectedUnchanged(
      appointment.id,
      () => postStatus(appointment.id, { to: "RESCHEDULED", expectedStatus: from }),
      400,
      "USE_RESCHEDULE",
    );
  });

  it("유예시간 전의 노쇼는 409 NO_SHOW_TOO_EARLY", async () => {
    // 지금 막 지난 예약 (유예 30분 안)
    const appointment = await book({ chair: "C1", startAt: floorToSlot(new Date(Date.now() - 5 * MINUTE)) });
    await expectRejectedUnchanged(
      appointment.id,
      () => postStatus(appointment.id, { to: "NO_SHOW", expectedStatus: "BOOKED", reasonCode: "NO_CONTACT" }),
      409,
      "NO_SHOW_TOO_EARLY",
    );
    const future = await book(nextSlot("future"));
    await expectRejectedUnchanged(
      future.id,
      () => postStatus(future.id, { to: "NO_SHOW", expectedStatus: "BOOKED", reasonCode: "NO_CONTACT" }),
      409,
      "NO_SHOW_TOO_EARLY",
    );
  });

  it.each(["NO_SHOW", "CANCELED_SAME_DAY"] as const)("%s에 사유가 없으면 400 REASON_REQUIRED", async (to) => {
    const appointment = await book(nextSlot("past"));
    for (const reasonCode of [undefined, null]) {
      await expectRejectedUnchanged(
        appointment.id,
        () => postStatus(appointment.id, { to, expectedStatus: "BOOKED", reasonCode }),
        400,
        "REASON_REQUIRED",
      );
    }
  });

  it("없는 사유 코드는 400 VALIDATION_FAILED", async () => {
    const appointment = await book(nextSlot("past"));
    await expectRejectedUnchanged(
      appointment.id,
      () => postStatus(appointment.id, { to: "NO_SHOW", expectedStatus: "BOOKED", reasonCode: "WHATEVER" as VisitReasonCode }),
      400,
      "VALIDATION_FAILED",
    );
  });

  it("취소 종류가 날짜와 맞지 않으면 400", async () => {
    const future = await book(nextSlot("future"));
    await expectRejectedUnchanged(
      future.id,
      () => postStatus(future.id, { to: "CANCELED_SAME_DAY", expectedStatus: "BOOKED", reasonCode: "PERSONAL" }),
      400,
      "CANCEL_IS_ADVANCE",
    );
    const past = await book(nextSlot("past"));
    await expectRejectedUnchanged(
      past.id,
      () => postStatus(past.id, { to: "CANCELED_ADVANCE", expectedStatus: "BOOKED" }),
      400,
      "CANCEL_IS_SAME_DAY",
    );
  });

  it("예약일 전의 내원은 409 ARRIVAL_BEFORE_APPOINTMENT_DAY", async () => {
    const future = await book(nextSlot("future"));
    await expectRejectedUnchanged(
      future.id,
      () => postStatus(future.id, { to: "ARRIVED", expectedStatus: "BOOKED" }),
      409,
      "ARRIVAL_BEFORE_APPOINTMENT_DAY",
    );
  });

  it("화면이 본 상태(expectedStatus)가 다르면 409 STATUS_CHANGED", async () => {
    const appointment = await book(nextSlot("past"));
    await expectRejectedUnchanged(
      appointment.id,
      () => postStatus(appointment.id, { to: "ARRIVED", expectedStatus: "CONFIRMED" }),
      409,
      "STATUS_CHANGED",
    );
  });

  it("원장(DOCTOR)은 403 FORBIDDEN이고 DENIED 감사 행이 남는다", async () => {
    const doctor = await loginAs("DOCTOR");
    const appointment = await book(nextSlot("past"));
    await expectRejectedUnchanged(
      appointment.id,
      () => postStatus(appointment.id, { to: "ARRIVED", expectedStatus: "BOOKED" }, doctor.cookie),
      403,
      "FORBIDDEN",
    );
    await expectRejectedUnchanged(appointment.id, () => postRevert(appointment.id, "BOOKED", doctor.cookie), 403, "FORBIDDEN");
    const denied = await db.auditLog.findMany({ where: { staffId: doctor.staff.id, result: "DENIED" } });
    expect(denied.map((row) => row.action).sort()).toEqual(["VISIT_STATUS_CHANGE", "VISIT_STATUS_REVERT"]);
  });

  it("로그인하지 않으면 401", async () => {
    const appointment = await book(nextSlot("past"));
    await expectRejectedUnchanged(
      appointment.id,
      () => postStatus(appointment.id, { to: "ARRIVED", expectedStatus: "BOOKED" }, ""),
      401,
      "UNAUTHENTICATED",
    );
  });

  it("노쇼로 비운 자리에 다른 예약이 들어왔으면 늦은 내원·대기로 되돌리기는 409 CHAIR_CONFLICT", async () => {
    const appointment = await appointmentIn("NO_SHOW");
    await book({ startAt: appointment.startAt, chair: appointment.chair });
    for (const to of ["ARRIVED", "BOOKED", "CONFIRMED"] as const) {
      await expectRejectedUnchanged(
        appointment.id,
        () => postStatus(appointment.id, { to, expectedStatus: "NO_SHOW" }),
        409,
        "CHAIR_CONFLICT",
      );
    }
    await expectRejectedUnchanged(appointment.id, () => postRevert(appointment.id, "NO_SHOW"), 409, "CHAIR_CONFLICT");
  });

  it("없는 예약은 404, 실패도 감사 행이 남는다", async () => {
    const res = await postStatus("01900000-0000-7000-8000-0000000000aa", { to: "ARRIVED", expectedStatus: "BOOKED" });
    expect(res.status).toBe(404);
    const audit = await db.auditLog.findFirst({ where: { action: "VISIT_STATUS_CHANGE" } });
    expect(audit).toMatchObject({ result: "FAILED", staffId: front.staff.id });
  });
});

// --- 한 트랜잭션 ---

describe("이력을 쓰지 못하면 상태도 바뀌지 않는다", () => {
  it("이력의 입력자가 없는 직원이면(FK 위반) 상태·내원 시각·노쇼 횟수 모두 그대로", async () => {
    const appointment = await book(nextSlot("past"));
    const before = await snapshot(appointment.id);
    const ghostStaff = { id: "01900000-0000-7000-8000-0000000000ff" };

    for (const to of ["NO_SHOW", "ARRIVED"] as const) {
      await expect(
        changeStatus({
          appointmentId: appointment.id,
          to,
          reasonCode: "NO_CONTACT",
          expectedStatus: "BOOKED",
          actor: ghostStaff,
          now: new Date(),
        }),
      ).rejects.toThrow();
      expect(await snapshot(appointment.id)).toEqual(before);
    }
  });
});

// --- 입력 기기 ---

describe("입력 기기 (요청 헤더 x-input-device → visit_status_log.input_device)", () => {
  /** 브라우저 apiFetch가 보내는 형식("web-" + 16진수 12자) */
  const DEVICE = "web-0123456789ab";

  async function latestLog(appointmentId: string) {
    return db.visitStatusLog.findFirstOrThrow({ where: { appointmentId }, orderBy: { createdAt: "desc" } });
  }

  it("상태 변경은 보낸 기기 id를 그대로 남긴다", async () => {
    const appointment = await book(nextSlot("past"));
    const res = await postStatus(appointment.id, { to: "ARRIVED", expectedStatus: "BOOKED" }, front.cookie, {
      "x-input-device": DEVICE,
    });
    expect(res.status).toBe(200);
    expect(await latestLog(appointment.id)).toMatchObject({ fromStatus: "BOOKED", toStatus: "ARRIVED", inputDevice: DEVICE });
  });

  it("되돌리기도 기기 id를 남긴다", async () => {
    const appointment = await book(nextSlot("past"));
    expect((await postStatus(appointment.id, { to: "ARRIVED", expectedStatus: "BOOKED" })).status).toBe(200);
    const res = await postRevert(appointment.id, "ARRIVED", front.cookie, { "x-input-device": DEVICE });
    expect(res.status).toBe(200);
    expect(await latestLog(appointment.id)).toMatchObject({ fromStatus: "ARRIVED", toStatus: "BOOKED", inputDevice: DEVICE });
  });

  // 헤더 값은 바이트열이라 한글은 UTF-8 바이트를 그대로 실어 보낸다(브라우저 밖 도구가 보낸 경우와 같다).
  const asWireBytes = (value: string) => Buffer.from(value, "utf8").toString("latin1");

  it.each(["접수 PC", "front pc", "가상기기", "web/0123", "   "])(
    "형식이 틀린 값 %j는 버리고 null로 남긴다 (변경 자체는 된다)",
    async (device) => {
      const appointment = await book(nextSlot("past"));
      const res = await postStatus(appointment.id, { to: "ARRIVED", expectedStatus: "BOOKED" }, front.cookie, {
        "x-input-device": asWireBytes(device),
      });
      expect(res.status).toBe(200);
      const log = await latestLog(appointment.id);
      expect(log).toMatchObject({ toStatus: "ARRIVED", inputDevice: null });
    },
  );

  it("헤더가 없으면 null", async () => {
    const appointment = await book(nextSlot("past"));
    expect((await postStatus(appointment.id, { to: "ARRIVED", expectedStatus: "BOOKED" })).status).toBe(200);
    expect((await latestLog(appointment.id)).inputDevice).toBeNull();
  });
});

describe("동시에 같은 변경", () => {
  it("같은 expectedStatus로 두 번 보내면 하나만 200, 하나는 409이고 이력은 한 행만 는다", async () => {
    const appointment = await book(nextSlot("past"));
    const results = await Promise.all([
      postStatus(appointment.id, { to: "ARRIVED", expectedStatus: "BOOKED" }),
      postStatus(appointment.id, { to: "NO_SHOW", expectedStatus: "BOOKED", reasonCode: "NO_CONTACT" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)?.json.error.code).toBe("STATUS_CHANGED");
    expect(await logsOf(appointment.id)).toHaveLength(2); // 생성 행 + 한 번의 변경
  });
});

// --- 시각 경계 (고정 시각, 서비스 직접 호출) ---

describe("시각 규칙 (고정 시각)", () => {
  // 실제 지금보다 충분히 뒤 (생성 이력의 시각이 앞서도록)
  const START = kstDateTime(addDays(kstDateKey(new Date()), 30), "10:00");
  const at = (minutes: number) => new Date(START.getTime() + minutes * MINUTE);

  async function change(appointmentId: string, to: AppointmentStatus, expectedStatus: AppointmentStatus, now: Date) {
    return changeStatus({ appointmentId, to, expectedStatus, reasonCode: "NO_CONTACT", actor: front.staff, now });
  }

  it("노쇼는 예약 시각 + 유예시간(30분)부터", async () => {
    const appointment = await book({ chair: "C1", startAt: START });
    await expect(change(appointment.id, "NO_SHOW", "BOOKED", new Date(at(30).getTime() - 1))).rejects.toMatchObject({
      status: 409,
      code: "NO_SHOW_TOO_EARLY",
    });
    expect((await snapshot(appointment.id)).logCount).toBe(1);
    const ok = await change(appointment.id, "NO_SHOW", "BOOKED", at(30));
    expect(ok.appointment.status).toBe("NO_SHOW");
  });

  it("유예시간은 병원 설정을 따른다", async () => {
    await db.clinicSetting.update({ where: { id: 1 }, data: { noShowGraceMin: 10 } });
    const appointment = await book({ chair: "C1", startAt: START });
    const ok = await change(appointment.id, "NO_SHOW", "BOOKED", at(10));
    expect(ok.appointment.status).toBe("NO_SHOW");
  });

  it("내원 시각과 지각 판정 (허용 15분)", async () => {
    const onTime = await book({ chair: "C1", startAt: START });
    const late = await book({ chair: "C2", startAt: START });
    const a = await change(onTime.id, "ARRIVED", "BOOKED", at(15));
    const b = await change(late.id, "ARRIVED", "BOOKED", at(16));
    expect(a).toMatchObject({ isLate: false, appointment: { arrivedAt: at(15) } });
    expect(b).toMatchObject({ isLate: true, appointment: { arrivedAt: at(16) } });
  });

  it("arrived_at: 원내 단계 사이에서는 유지, 대기·노쇼로 가면 지움, 노쇼에서 내원하면 새로", async () => {
    const appointment = await book({ chair: "C1", startAt: START });
    const id = appointment.id;
    const arrivedAt = async () => (await db.appointment.findUniqueOrThrow({ where: { id } })).arrivedAt;

    await change(id, "ARRIVED", "BOOKED", at(5));
    await change(id, "IN_TREATMENT", "ARRIVED", at(20));
    await change(id, "PAID", "IN_TREATMENT", at(60));
    await change(id, "LEFT", "PAID", at(70));
    expect(await arrivedAt()).toEqual(at(5));
    await change(id, "PAID", "LEFT", at(71));
    await change(id, "IN_TREATMENT", "PAID", at(72));
    await change(id, "ARRIVED", "IN_TREATMENT", at(73));
    expect(await arrivedAt()).toEqual(at(5));

    await change(id, "CONFIRMED", "ARRIVED", at(74));
    expect(await arrivedAt()).toBeNull();
    await change(id, "ARRIVED", "CONFIRMED", at(75));
    expect(await arrivedAt()).toEqual(at(75));
    await change(id, "NO_SHOW", "ARRIVED", at(76));
    expect(await arrivedAt()).toBeNull();
    const late = await change(id, "ARRIVED", "NO_SHOW", at(90));
    expect(await arrivedAt()).toEqual(at(90));
    expect(late.isLate).toBe(true);

    // 이력의 입력 시각은 now 그대로
    const logs = await logsOf(id);
    expect(logs.at(-1)?.createdAt).toEqual(at(90));
  });

  it("no_show_count: 노쇼로 들어가면 +1, 나오면 -1, 0 아래로 내려가지 않는다", async () => {
    const appointment = await book({ chair: "C1", startAt: START });
    const count = async () =>
      (await db.patient.findUniqueOrThrow({ where: { id: appointment.patientId } })).noShowCount;

    await change(appointment.id, "NO_SHOW", "BOOKED", at(40));
    expect(await count()).toBe(1);
    await change(appointment.id, "ARRIVED", "NO_SHOW", at(41));
    expect(await count()).toBe(0);
    await change(appointment.id, "NO_SHOW", "ARRIVED", at(42));
    expect(await count()).toBe(1);
    await change(appointment.id, "CONFIRMED", "NO_SHOW", at(43));
    expect(await count()).toBe(0);
    await change(appointment.id, "NO_SHOW", "CONFIRMED", at(44));
    expect(await count()).toBe(1);

    // 캐시가 어긋나 0인 상태에서 노쇼를 벗어나도 음수가 되지 않는다
    await db.patient.update({ where: { id: appointment.patientId }, data: { noShowCount: 0 } });
    await change(appointment.id, "BOOKED", "NO_SHOW", at(45));
    expect(await count()).toBe(0);
  });

  it("요청 시각이 직전 이력보다 이르면 이력 시각은 직전 이력 바로 뒤가 된다(이력 순서 보장)", async () => {
    const appointment = await book({ chair: "C1", startAt: START });
    await change(appointment.id, "ARRIVED", "BOOKED", at(20));
    await change(appointment.id, "BOOKED", "ARRIVED", at(10));
    const logs = await logsOf(appointment.id);
    expect(logs.map((log) => log.toStatus)).toEqual(["BOOKED", "ARRIVED", "BOOKED"]);
    expect(logs[2].createdAt.getTime()).toBe(at(20).getTime() + 1);
  });
});

// --- 되돌리기 ---

describe("POST /api/appointments/[id]/revert", () => {
  it("내원을 되돌리면 이전 대기 상태(확인완료)로, 이력은 한 행 더", async () => {
    const appointment = await appointmentIn("CONFIRMED");
    expect((await postStatus(appointment.id, { to: "ARRIVED", expectedStatus: "CONFIRMED" })).status).toBe(200);

    const res = await postRevert(appointment.id, "ARRIVED");
    expect(res.status).toBe(200);
    expect(res.json.appointment).toMatchObject({ status: "CONFIRMED", arrivedAt: null });
    const logs = await logsOf(appointment.id);
    expect(logs.map((log) => [log.fromStatus, log.toStatus])).toEqual([
      [null, "BOOKED"],
      ["BOOKED", "CONFIRMED"],
      ["CONFIRMED", "ARRIVED"],
      ["ARRIVED", "CONFIRMED"],
    ]);
    const audit = await db.auditLog.findFirst({ where: { action: "VISIT_STATUS_REVERT" } });
    expect(audit).toMatchObject({ result: "SUCCESS", patientId: appointment.patientId });
  });

  it("노쇼 → 내원을 되돌리면 원래 사유와 함께 노쇼로, 노쇼 횟수도 돌아온다", async () => {
    const appointment = await book(nextSlot("past"));
    expect(
      (await postStatus(appointment.id, { to: "NO_SHOW", expectedStatus: "BOOKED", reasonCode: "OTHER_CLINIC" })).status,
    ).toBe(200);
    expect((await postStatus(appointment.id, { to: "ARRIVED", expectedStatus: "NO_SHOW" })).status).toBe(200);

    const res = await postRevert(appointment.id, "ARRIVED");
    expect(res.status).toBe(200);
    expect(res.json.appointment.status).toBe("NO_SHOW");
    const last = (await logsOf(appointment.id)).at(-1);
    expect(last).toMatchObject({ fromStatus: "ARRIVED", toStatus: "NO_SHOW", reasonCode: "OTHER_CLINIC" });
    const patient = await db.patient.findUniqueOrThrow({ where: { id: appointment.patientId } });
    expect(patient.noShowCount).toBe(1);
  });

  it("당일취소를 되돌리면 예약확정으로", async () => {
    const appointment = await appointmentIn("CANCELED_SAME_DAY");
    const res = await postRevert(appointment.id, "CANCELED_SAME_DAY");
    expect(res.status).toBe(200);
    expect(res.json.appointment.status).toBe("BOOKED");
  });

  it("당일취소로 비운 자리에 다른 예약이 들어왔으면 되돌리기는 409 CHAIR_CONFLICT, 그대로", async () => {
    const appointment = await appointmentIn("CANCELED_SAME_DAY");
    await book({ startAt: appointment.startAt, chair: appointment.chair });
    await expectRejectedUnchanged(
      appointment.id,
      () => postRevert(appointment.id, "CANCELED_SAME_DAY"),
      409,
      "CHAIR_CONFLICT",
    );
  });

  it("생성 이력만 있으면 409 NOTHING_TO_REVERT", async () => {
    const appointment = await book(nextSlot("past"));
    await expectRejectedUnchanged(appointment.id, () => postRevert(appointment.id, "BOOKED"), 409, "NOTHING_TO_REVERT");
  });

  it("화면이 본 상태가 다르면 409 STATUS_CHANGED", async () => {
    const appointment = await appointmentIn("ARRIVED");
    await expectRejectedUnchanged(appointment.id, () => postRevert(appointment.id, "BOOKED"), 409, "STATUS_CHANGED");
  });

  it("예약변경은 되돌릴 수 없다 (새 예약이 이어받음)", async () => {
    const appointment = await appointmentIn("RESCHEDULED", "future");
    await expectRejectedUnchanged(appointment.id, () => postRevert(appointment.id, "RESCHEDULED"), 409, "NOT_ALLOWED");
  });
});

// --- 예약변경 ---

describe("POST /api/appointments/[id]/reschedule", () => {
  it("원 예약은 예약변경, 새 예약은 원 예약 id를 갖고 예약확정으로 생긴다", async () => {
    const original = await book(nextSlot("future"));
    const counselor = await loginAs("COUNSELOR");
    await db.appointment.update({
      where: { id: original.id },
      data: { channel: "WEBSITE", memo: "오후 진료 선호", counselorId: counselor.staff.id },
    });
    const newStart = new Date(original.startAt.getTime() + 24 * 60 * MINUTE);

    const res = await postReschedule(original.id, { startAt: newStart.toISOString(), expectedStatus: "BOOKED" });
    expect(res.status).toBe(200);

    const after = await db.appointment.findUniqueOrThrow({ where: { id: original.id } });
    expect(after.status).toBe("RESCHEDULED");
    const created = await db.appointment.findUniqueOrThrow({ where: { originalAppointmentId: original.id } });
    expect(created).toMatchObject({
      id: res.json.appointment.id,
      patientId: original.patientId,
      status: "BOOKED",
      startAt: newStart,
      durationMin: original.durationMin,
      chair: original.chair,
      treatmentItem: original.treatmentItem,
      channel: "WEBSITE",
      memo: "오후 진료 선호",
      counselorId: counselor.staff.id,
      createdById: front.staff.id,
    });
    expect((await logsOf(original.id)).at(-1)).toMatchObject({ fromStatus: "BOOKED", toStatus: "RESCHEDULED", staffId: front.staff.id });
    expect((await logsOf(created.id)).map((log) => [log.fromStatus, log.toStatus])).toEqual([[null, "BOOKED"]]);

    const audit = await db.auditLog.findFirst({ where: { action: "APPOINTMENT_RESCHEDULE" } });
    expect(audit).toMatchObject({ result: "SUCCESS", patientId: original.patientId });
  });

  it("같은 체어에서 시간만 조금 옮겨도 된다(원 예약이 자리를 비움), 값을 바꿀 수도 있다", async () => {
    const original = await book(nextSlot("future"));
    const newStart = new Date(original.startAt.getTime() + 15 * MINUTE);
    const res = await postReschedule(original.id, {
      startAt: newStart.toISOString(),
      durationMin: 60,
      treatmentItem: "스케일링",
      expectedStatus: "BOOKED",
    });
    expect(res.status).toBe(200);
    expect(res.json.appointment).toMatchObject({ chair: original.chair, durationMin: 60, treatmentItem: "스케일링" });
  });

  it("그만둔 상담 담당자는 그대로 옮길 수 없고(400), counselorId를 null이나 다른 사람으로 보내면 된다", async () => {
    const original = await book(nextSlot("future"));
    const leaver = await loginAs("COUNSELOR");
    const other = await loginAs("COUNSELOR");
    await db.appointment.update({ where: { id: original.id }, data: { counselorId: leaver.staff.id } });
    await db.staff.update({ where: { id: leaver.staff.id }, data: { isActive: false } });
    const newStart = new Date(original.startAt.getTime() + 24 * 60 * MINUTE).toISOString();

    await expectRejectedUnchanged(
      original.id,
      () => postReschedule(original.id, { startAt: newStart, expectedStatus: "BOOKED" }),
      400,
      "VALIDATION_FAILED",
    );
    expect(await db.appointment.count({ where: { originalAppointmentId: original.id } })).toBe(0);

    const replaced = await postReschedule(original.id, { startAt: newStart, counselorId: other.staff.id, expectedStatus: "BOOKED" });
    expect(replaced.status).toBe(200);
    expect(replaced.json.appointment.counselorId).toBe(other.staff.id);
    const created = await db.appointment.findUniqueOrThrow({ where: { originalAppointmentId: original.id } });
    expect(created.counselorId).toBe(other.staff.id);
  });

  it("상담 담당자를 null로 보내면 비운다", async () => {
    const original = await book(nextSlot("future"));
    const counselor = await loginAs("COUNSELOR");
    await db.appointment.update({ where: { id: original.id }, data: { counselorId: counselor.staff.id } });
    const newStart = new Date(original.startAt.getTime() + 24 * 60 * MINUTE).toISOString();
    const res = await postReschedule(original.id, { startAt: newStart, counselorId: null, expectedStatus: "BOOKED" });
    expect(res.status).toBe(200);
    const created = await db.appointment.findUniqueOrThrow({ where: { originalAppointmentId: original.id } });
    expect(created.counselorId).toBeNull();
  });

  it("새 자리가 겹치면 409 CHAIR_CONFLICT이고 원 예약도 그대로(둘 다 되돌림)", async () => {
    const original = await book(nextSlot("future"));
    const blocker = await book(nextSlot("future"));
    await expectRejectedUnchanged(
      original.id,
      () =>
        postReschedule(original.id, {
          startAt: blocker.startAt.toISOString(),
          chair: blocker.chair,
          expectedStatus: "BOOKED",
        }),
      409,
      "CHAIR_CONFLICT",
    );
    expect(await db.appointment.count({ where: { originalAppointmentId: original.id } })).toBe(0);
  });

  it("지난 날짜로는 바꿀 수 없다 (400 PAST_DATE, 새 예약 없음)", async () => {
    const original = await book(nextSlot("future"));
    const yesterday = kstDateTime(addDays(kstDateKey(new Date()), -1), "10:00").toISOString();
    await expectRejectedUnchanged(
      original.id,
      () => postReschedule(original.id, { startAt: yesterday, expectedStatus: "BOOKED" }),
      400,
      "PAST_DATE",
    );
    expect(await db.appointment.count({ where: { originalAppointmentId: original.id } })).toBe(0);
  });

  it("이미 예약변경된 예약은 다시 바꿀 수 없다", async () => {
    const original = await book(nextSlot("future"));
    const newStart = new Date(original.startAt.getTime() + 24 * 60 * MINUTE);
    expect((await postReschedule(original.id, { startAt: newStart.toISOString(), expectedStatus: "BOOKED" })).status).toBe(200);
    const again = new Date(newStart.getTime() + 60 * MINUTE).toISOString();
    await expectRejectedUnchanged(
      original.id,
      () => postReschedule(original.id, { startAt: again, expectedStatus: "BOOKED" }),
      409,
      "STATUS_CHANGED",
    );
    await expectRejectedUnchanged(
      original.id,
      () => postReschedule(original.id, { startAt: again, expectedStatus: "RESCHEDULED" }),
      409,
      "NOT_ALLOWED",
    );
  });

  it("5분 단위가 아닌 시각은 400, 원장은 403", async () => {
    const original = await book(nextSlot("future"));
    const odd = new Date(original.startAt.getTime() + 24 * 60 * MINUTE + 3 * MINUTE).toISOString();
    await expectRejectedUnchanged(
      original.id,
      () => postReschedule(original.id, { startAt: odd, expectedStatus: "BOOKED" }),
      400,
      "VALIDATION_FAILED",
    );
    const doctor = await loginAs("DOCTOR");
    const ok = new Date(original.startAt.getTime() + 24 * 60 * MINUTE).toISOString();
    await expectRejectedUnchanged(
      original.id,
      () => postReschedule(original.id, { startAt: ok, expectedStatus: "BOOKED" }, doctor.cookie),
      403,
      "FORBIDDEN",
    );
  });
});

// --- 상태를 바꾸는 길은 정해진 파일뿐 ---

describe("appointment.status를 쓰는 코드", () => {
  const SRC = fileURLToPath(new URL("../../src", import.meta.url));
  /** 상태를 쓸 수 있는 파일: 상태 변경, 예약 생성(첫 BOOKED), 예약변경 */
  // import/appointments.ts: 기존 CRM 이력 가져오기(F-7) — 상태와 상태 이력을 한 트랜잭션에 함께 쓴다(import.test.ts가 확인).
  const ALLOWED = [
    "server/appointments/status.ts",
    "server/appointments/create.ts",
    "server/appointments/reschedule.ts",
    "server/import/appointments.ts",
  ];
  const WRITE_CALL = /\.appointment\.(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert)\s*\(/g;
  const RAW_WRITE = /(UPDATE|INSERT\s+INTO)\s+"?appointment"?\s/gi;

  /** open 위치의 괄호부터 짝이 맞는 닫는 괄호까지 */
  function balanced(source: string, openIndex: number, open = "(", close = ")"): string {
    let depth = 0;
    for (let i = openIndex; i < source.length; i++) {
      if (source[i] === open) depth++;
      else if (source[i] === close && --depth === 0) return source.slice(openIndex, i + 1);
    }
    return source.slice(openIndex);
  }

  /** 모델을 변수에 담아 쓰면(const m = tx.appointment) 호출을 찾을 수 없으므로 그 자체를 잡는다 */
  const ALIAS = /\b(db|tx|client|prisma)\.appointment(?![\w.])/g;

  /**
   * 쓰기 호출의 쓰는 값(data·create·update)에 status가 있는지. where의 status 조건은 읽기라 제외.
   * 값이 객체 리터럴이 아니거나(변수·축약 `{ data }`) 펼치기(...)를 쓰면 안을 볼 수 없으므로 쓰는 것으로 본다.
   */
  function writesStatus(callText: string): boolean {
    for (const key of callText.matchAll(/\b(data|create|update)\b\s*(:\s*(\{)?|(?=[,}]))/g)) {
      if (!key[3]) return true; // 리터럴이 아님
      const object = balanced(callText, key.index + key[0].length - 1, "{", "}");
      if (/\bstatus\b|\.\.\./.test(object)) return true;
    }
    return false;
  }

  function offenders(): string[] {
    const files = (readdirSync(SRC, { recursive: true }) as string[])
      .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file))
      .map((file) => file.split(sep).join("/"))
      .filter((file) => !file.startsWith("generated/") && !ALLOWED.includes(file));
    const found: string[] = [];
    for (const file of files) {
      const source = readFileSync(join(SRC, file), "utf8");
      for (const match of source.matchAll(WRITE_CALL)) {
        if (writesStatus(balanced(source, match.index + match[0].length - 1))) found.push(`${file}: ${match[0]}`);
      }
      if (RAW_WRITE.test(source)) found.push(`${file}: raw SQL`);
      RAW_WRITE.lastIndex = 0;
      for (const match of source.matchAll(ALIAS)) found.push(`${file}: ${match[0]} (변수에 담은 모델)`);
    }
    return found;
  }

  it("허용된 파일 밖에서 appointment에 status를 쓰는 코드가 없다", () => {
    expect(offenders()).toEqual([]);
  });

  it("검사기가 실제로 잡는다 (자기 점검)", () => {
    const check = (sample: string) => {
      const match = [...sample.matchAll(WRITE_CALL)][0];
      return writesStatus(balanced(sample, match.index + match[0].length - 1));
    };
    expect(check('await tx.appointment.update({ where: { id }, data: { status: "ARRIVED" } });')).toBe(true);
    expect(check('db.appointment.updateMany({ where: { id, status: "BOOKED" }, data: { arrivedAt: { set: null }, status } })')).toBe(true);
    expect(check('db.appointment.updateMany({ where: { id, status: { in: ["BOOKED"] } }, data: { chair } })')).toBe(false);
    // 안을 볼 수 없는 값은 쓰는 것으로 본다
    expect(check("tx.appointment.update({ where, data })")).toBe(true);
    expect(check("tx.appointment.update({ where: { id }, data: patch })")).toBe(true);
    expect(check("tx.appointment.update({ where: { id }, data: { ...patch, chair } })")).toBe(true);
    expect(check("tx.appointment.upsert({ where: { id }, create: built, update: { chair } })")).toBe(true);
    expect("const m = tx.appointment;".match(ALIAS)).not.toBeNull();
    expect("tx.appointment.findMany({})".match(ALIAS)).toBeNull();
    expect(RAW_WRITE.test('UPDATE "appointment" SET status = 1')).toBe(true);
    RAW_WRITE.lastIndex = 0;
  });
});
