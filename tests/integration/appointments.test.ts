/**
 * T4-1 예약 생성·조회 API — 완료 기준: 같은 체어·시간 중복 예약 차단.
 * 환자는 지어낸 이름과 배정되지 않는 010-0XXX-XXXX 번호만 쓴다(절대 규칙 1).
 */
import { randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CLINIC_SETTINGS } from "@/lib/domain/clinic";
import { addDays, kstDateKey, kstDateTime } from "@/lib/time/kst";
import { GET as getDetail } from "@/app/api/appointments/[id]/route";
import { PATCH as moveRoute } from "@/app/api/appointments/[id]/move/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/appointments/route";
import { GET as settingsRoute } from "@/app/api/settings/route";
import { createAppointment as createAppointmentService } from "@/server/appointments/create";
import { ApiError } from "@/server/api/errors";
import { sealPhone } from "@/server/crypto/pii";
import { callRoute, loginAs } from "./helpers/api";
import { createAppointment as insertAppointmentRow, createPatient, createStaff, db, resetDb } from "./helpers";
import { INITIAL_DEPARTMENT_HOMES } from "@/lib/auth/screen-registry";

beforeAll(() => {
  // 키는 실행마다 새로 만든다. 저장소에는 키 문자열을 두지 않는다.
  process.env.PII_ENC_KEY = randomBytes(32).toString("base64");
  process.env.PII_HMAC_KEY = randomBytes(32).toString("base64");
});

beforeEach(async () => {
  await resetDb();
  await db.clinicSetting.create({
    data: {
      id: 1,
      lateToleranceMin: DEFAULT_CLINIC_SETTINGS.lateToleranceMin,
      noShowGraceMin: DEFAULT_CLINIC_SETTINGS.noShowGraceMin,
      businessHours: DEFAULT_CLINIC_SETTINGS.businessHours,
      chairs: DEFAULT_CLINIC_SETTINGS.chairs,
      treatmentItems: DEFAULT_CLINIC_SETTINGS.treatmentItems,
    },
  });
});

/** 테스트 날짜: 실제 오늘(한국 시간)로부터 7일 뒤 — 옮기기의 '지난 날짜' 검사에 걸리지 않게 */
const DAY = addDays(kstDateKey(new Date()), 7);
const at = (time: string, day = DAY) => kstDateTime(day, time).toISOString();

async function fakePatient(phone = "010-0123-4567") {
  return createPatient({ ...sealPhone(phone), visitType: "NEW", referralSource: "WEBSITE" });
}

function body(patientId: string, overrides: Record<string, unknown> = {}) {
  return {
    patientId,
    startAt: at("10:00"),
    durationMin: 30,
    chair: "C1",
    treatmentItem: "정기검진",
    channel: "PHONE",
    ...overrides,
  };
}

async function create(cookie: string, payload: Record<string, unknown>, headers?: Record<string, string>) {
  return callRoute(createRoute, { method: "POST", url: "/api/appointments", cookie, body: payload, headers });
}

describe("완료 기준: 같은 체어·시간 중복 예약 차단", () => {
  it("같은 체어에 시간이 겹치면 두 번째는 409 CHAIR_CONFLICT이고, 예약·이력 행이 남지 않는다", async () => {
    const { cookie } = await loginAs("FRONT");
    const a = await fakePatient();
    const b = await fakePatient("010-0123-0000");
    expect((await create(cookie, body(a.id))).status).toBe(201);

    const res = await create(cookie, body(b.id, { startAt: at("10:15") }));
    expect(res.status).toBe(409);
    expect(res.json.error).toMatchObject({ code: "CHAIR_CONFLICT", message: "같은 체어에 겹치는 예약이 있습니다" });
    expect(await db.appointment.count()).toBe(1);
    expect(await db.visitStatusLog.count()).toBe(1);
    expect(await db.appointment.count({ where: { patientId: b.id } })).toBe(0);
  });

  it("끝 시각에 바로 이어 붙인 예약은 받는다 (10:00~10:30 다음 10:30)", async () => {
    const { cookie } = await loginAs("FRONT");
    const p = await fakePatient();
    expect((await create(cookie, body(p.id))).status).toBe(201);
    expect((await create(cookie, body(p.id, { startAt: at("10:30") }))).status).toBe(201);
    expect((await create(cookie, body(p.id, { startAt: at("09:30") }))).status).toBe(201);
  });

  it("다른 체어의 같은 시간은 받는다", async () => {
    const { cookie } = await loginAs("FRONT");
    const p = await fakePatient();
    expect((await create(cookie, body(p.id))).status).toBe(201);
    expect((await create(cookie, body(p.id, { chair: "C2" }))).status).toBe(201);
  });

  it.each(["CANCELED_SAME_DAY", "CANCELED_ADVANCE", "NO_SHOW", "RESCHEDULED"] as const)(
    "%s 예약이 있던 자리에는 새 예약을 넣을 수 있다",
    async (status) => {
      const { cookie } = await loginAs("FRONT");
      const p = await fakePatient();
      await insertAppointmentRow({ patientId: p.id, chair: "C1", startAt: new Date(at("10:00")), status });
      expect((await create(cookie, body(p.id))).status).toBe(201);
    },
  );

  it("같은 자리를 동시에 잡으면 정확히 하나만 201이다", async () => {
    const { cookie } = await loginAs("FRONT");
    const patients = await Promise.all([fakePatient(), fakePatient("010-0111-2222"), fakePatient("010-0333-4444")]);
    const results = await Promise.all(patients.map((p) => create(cookie, body(p.id))));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409]);
    expect(await db.appointment.count()).toBe(1);
    expect(await db.visitStatusLog.count()).toBe(1);
  });

  it("이미 찬 자리로 옮기면 409이고 예약은 그대로다", async () => {
    const { cookie } = await loginAs("FRONT");
    const p = await fakePatient();
    await create(cookie, body(p.id, { startAt: at("10:00") }));
    const second = await create(cookie, body(p.id, { startAt: at("11:00") }));
    const id = second.json.appointment.id as string;

    const res = await callRoute(moveRoute, {
      method: "PATCH",
      url: `/api/appointments/${id}/move`,
      cookie,
      params: { id },
      body: { startAt: at("10:20") },
    });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("CHAIR_CONFLICT");
    const row = await db.appointment.findUniqueOrThrow({ where: { id } });
    expect(row.startAt.toISOString()).toBe(at("11:00"));
  });
});

describe("createAppointment — 예약과 첫 이력은 한 트랜잭션", () => {
  /** 약속이 거부되면 던진 값을, 성공하면 테스트를 실패시킨다 */
  async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(
      () => expect.fail("거부되어야 한다"),
      (error: unknown) => error,
    );
  }

  /** 검증(ApiError)이 아니라 DB의 visit_status_log INSERT에서 난 에러인지 */
  function expectLogInsertFailure(error: unknown) {
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ApiError);
    expect((error as Error).message).toContain("visitStatusLog.create");
  }

  it("이력 첫 행 쓰기가 실패하면 예약 행도 남지 않는다", async () => {
    const { staff } = await loginAs("FRONT");
    const p = await fakePatient();
    // PostgreSQL text에는 NUL 문자를 넣을 수 없다 → 예약 INSERT는 성공하고 이력 INSERT만 실패한다.
    const error = await rejectionOf(
      createAppointmentService(
        {
          patientId: p.id,
          startAt: new Date(at("10:00")),
          durationMin: 30,
          chair: "C1",
          treatmentItem: "정기검진",
          channel: "PHONE",
        },
        { actorId: staff.id, inputDevice: "x\u0000y" },
      ),
    );
    expectLogInsertFailure(error);
    expect(await db.appointment.count()).toBe(0);
    expect(await db.visitStatusLog.count()).toBe(0);
  });

  it("호출자 트랜잭션(tx)에서 이력 쓰기가 실패하면 함께 되돌려진다", async () => {
    const { staff } = await loginAs("FRONT");
    const p = await fakePatient();
    const error = await rejectionOf(
      db.$transaction((tx) =>
        createAppointmentService(
          {
            patientId: p.id,
            startAt: new Date(at("10:00")),
            durationMin: 30,
            chair: "C1",
            treatmentItem: "정기검진",
            channel: "PHONE",
          },
          { actorId: staff.id, inputDevice: "x\u0000y", tx },
        ),
      ),
    );
    expectLogInsertFailure(error);
    expect(await db.appointment.count()).toBe(0);
    expect(await db.visitStatusLog.count()).toBe(0);
  });
});

describe("POST /api/appointments", () => {
  it("예약과 상태 이력 첫 행(null → BOOKED)을 정확히 한 개 쓰고 감사 행을 남긴다", async () => {
    const { cookie, staff } = await loginAs("FRONT");
    const doctor = await createStaff({ role: "DOCTOR", name: "가상의사" });
    const counselor = await createStaff({ role: "COUNSELOR" });
    const p = await fakePatient();
    const res = await create(
      cookie,
      body(p.id, { doctorId: doctor.id, counselorId: counselor.id, durationMin: 45, memo: "가상 메모" }),
      { "x-input-device": "front-pc-1" },
    );
    expect(res.status).toBe(201);
    const { appointment } = res.json;
    expect(appointment).toMatchObject({
      patientId: p.id,
      status: "BOOKED",
      chair: "C1",
      durationMin: 45,
      doctorId: doctor.id,
      counselorId: counselor.id,
      createdById: staff.id,
      originalAppointmentId: null,
      startAt: at("10:00"),
      endAt: at("10:45"),
    });

    const logs = await db.visitStatusLog.findMany({ where: { appointmentId: appointment.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ fromStatus: null, toStatus: "BOOKED", staffId: staff.id, inputDevice: "front-pc-1" });

    const audits = await db.auditLog.findMany({ where: { action: "APPOINTMENT_CREATE" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ staffId: staff.id, patientId: p.id, result: "SUCCESS" });
    expect(JSON.stringify(audits[0].detail)).not.toContain("가상");
  });

  it("형식이 틀린 x-input-device(공백 포함)는 null로 남긴다", async () => {
    const { cookie } = await loginAs("FRONT");
    const p = await fakePatient();
    const res = await create(cookie, body(p.id), { "x-input-device": "front pc 1" });
    expect(res.status).toBe(201);
    const log = await db.visitStatusLog.findFirstOrThrow({ where: { appointmentId: res.json.appointment.id } });
    expect(log.inputDevice).toBeNull();
  });

  it("x-input-device가 없으면 입력 기기는 null", async () => {
    const { cookie } = await loginAs("COUNSELOR");
    const p = await fakePatient();
    const res = await create(cookie, body(p.id));
    expect(res.status).toBe(201);
    const log = await db.visitStatusLog.findFirstOrThrow({ where: { appointmentId: res.json.appointment.id } });
    expect(log.inputDevice).toBeNull();
  });

  it.each([
    ["없는 체어", { chair: "C9" }, "chair"],
    ["없는 예약 항목", { treatmentItem: "가상항목" }, "treatmentItem"],
    ["소요시간 5분 미만", { durationMin: 0 }, "durationMin"],
    ["소요시간 5분 단위 아님", { durationMin: 32 }, "durationMin"],
    ["소요시간 480분 초과", { durationMin: 485 }, "durationMin"],
    ["5분 단위가 아닌 시작 시각", { startAt: at("10:03") }, "startAt"],
    ["워크인 채널", { channel: "WALK_IN" }, "channel"],
    ["원 예약 id는 받지 않음", { originalAppointmentId: "0190f0f0-0000-7000-8000-000000000000" }, ""],
    ["상태는 받지 않음", { status: "ARRIVED" }, ""],
  ])("%s → 400", async (_label, overrides, path) => {
    const { cookie } = await loginAs("FRONT");
    const p = await fakePatient();
    const res = await create(cookie, body(p.id, overrides));
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("VALIDATION_FAILED");
    expect(res.json.error.fields.map((f: { path: string }) => f.path)).toContain(path);
    expect(await db.appointment.count()).toBe(0);
    expect(await db.visitStatusLog.count()).toBe(0);
  });

  it("의사 자리에 프론트 직원, 상담자 자리에 의사, 퇴사한 의사 → 400", async () => {
    const { cookie } = await loginAs("FRONT");
    const front = await createStaff({ role: "FRONT" });
    const doctor = await createStaff({ role: "DOCTOR" });
    const retired = await createStaff({ role: "DOCTOR", isActive: false });
    const p = await fakePatient();
    for (const [overrides, path] of [
      [{ doctorId: front.id }, "doctorId"],
      [{ counselorId: doctor.id }, "counselorId"],
      [{ doctorId: retired.id }, "doctorId"],
    ] as const) {
      const res = await create(cookie, body(p.id, overrides));
      expect(res.status).toBe(400);
      expect(res.json.error.fields).toEqual([{ path, code: "invalid_staff" }]);
    }
    expect(await db.appointment.count()).toBe(0);
  });

  it("관리자는 의사 자리에 넣을 수 있다", async () => {
    const { cookie, staff } = await loginAs("ADMIN");
    const p = await fakePatient();
    expect((await create(cookie, body(p.id, { doctorId: staff.id }))).status).toBe(201);
  });

  it("없는 고객 → 404", async () => {
    const { cookie } = await loginAs("FRONT");
    const res = await create(cookie, body("0190f0f0-0000-7000-8000-000000000000"));
    expect(res.status).toBe(404);
    expect(await db.appointment.count()).toBe(0);
  });

  it("의사는 예약을 만들 수 없다 (403)", async () => {
    const { cookie } = await loginAs("DOCTOR");
    const p = await fakePatient();
    const res = await create(cookie, body(p.id));
    expect(res.status).toBe(403);
    expect(await db.appointment.count()).toBe(0);
    expect(await db.auditLog.count({ where: { action: "APPOINTMENT_CREATE", result: "DENIED" } })).toBe(1);
  });

  it("로그인하지 않으면 401", async () => {
    const res = await create("", body("0190f0f0-0000-7000-8000-000000000000"));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/appointments", () => {
  const listUrl = (from: string, to: string, extra = "") => `/api/appointments?from=${from}&to=${to}${extra}`;

  it("한국 시간 날짜 범위로 조회한다 (자정 경계)", async () => {
    const p = await fakePatient("010-0123-9876");
    // 2026-11-12(목) 하루를 조회할 때: 00:00·23:55는 포함, 전날 23:55·다음날 00:00은 제외
    const rows = [
      ["2026-11-11", "23:55", "C1"],
      ["2026-11-12", "00:00", "C1"],
      ["2026-11-12", "23:55", "C2"],
      ["2026-11-13", "00:00", "C3"],
    ] as const;
    for (const [day, time, chair] of rows) {
      await insertAppointmentRow({ patientId: p.id, chair, startAt: kstDateTime(day, time), durationMin: 5 });
    }
    const { cookie } = await loginAs("DOCTOR");
    const res = await callRoute(listRoute, { url: listUrl("2026-11-12", "2026-11-12"), cookie });
    expect(res.status).toBe(200);
    expect(res.json.items.map((i: { startAt: string }) => i.startAt)).toEqual([
      kstDateTime("2026-11-12", "00:00").toISOString(),
      kstDateTime("2026-11-12", "23:55").toISOString(),
    ]);

    const two = await callRoute(listRoute, { url: listUrl("2026-11-11", "2026-11-12"), cookie });
    expect(two.json.items).toHaveLength(3);
  });

  it("마스킹한 이름·전화 뒷 4자리·신규 여부·의사 이름을 담고, 이름 원문과 전체 번호는 담지 않는다", async () => {
    const p = await createPatient({ name: "가상하나", ...sealPhone("010-0123-9876"), visitType: "NEW", referralSource: "WEBSITE" });
    const doctor = await createStaff({ role: "DOCTOR", name: "가상원장" });
    await insertAppointmentRow({ patientId: p.id, doctorId: doctor.id, startAt: kstDateTime("2026-11-12", "10:00") });
    const { cookie, staff } = await loginAs("FRONT");
    const res = await callRoute(listRoute, { url: listUrl("2026-11-12", "2026-11-12"), cookie });
    expect(res.json.items).toEqual([
      expect.objectContaining({
        patientId: p.id,
        patientNameMasked: "가**나",
        phoneLast4: "9876",
        isNewPatient: true,
        referralSource: "WEBSITE",
        doctorName: "가상원장",
        status: "BOOKED",
      }),
    ]);
    expect(res.text).not.toContain("가상하나");
    expect(res.text).not.toContain("01001239876");

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "APPOINTMENT_LIST", staffId: staff.id } });
    expect(audit).toMatchObject({ result: "SUCCESS", patientId: p.id });
    expect(audit.detail).toMatchObject({ patientCount: 1, appointmentCount: 1 });
  });

  it("체어·의사로 거른다", async () => {
    const p = await fakePatient();
    const doctor = await createStaff({ role: "DOCTOR" });
    const start = kstDateTime("2026-11-12", "10:00");
    await insertAppointmentRow({ patientId: p.id, chair: "C1", startAt: start, doctorId: doctor.id });
    await insertAppointmentRow({ patientId: p.id, chair: "C2", startAt: start });
    const { cookie } = await loginAs("FRONT");
    const byChair = await callRoute(listRoute, { url: listUrl("2026-11-12", "2026-11-12", "&chair=C2"), cookie });
    expect(byChair.json.items.map((i: { chair: string }) => i.chair)).toEqual(["C2"]);
    const byDoctor = await callRoute(listRoute, {
      url: listUrl("2026-11-12", "2026-11-12", `&doctorId=${doctor.id}`),
      cookie,
    });
    expect(byDoctor.json.items.map((i: { chair: string }) => i.chair)).toEqual(["C1"]);
  });

  it.each([
    ["42일 초과", "2026-11-01", "2026-12-13"],
    ["to가 from보다 앞", "2026-11-12", "2026-11-11"],
    ["없는 날짜", "2026-02-30", "2026-03-01"],
  ])("%s → 400", async (_label, from, to) => {
    const { cookie } = await loginAs("FRONT");
    expect((await callRoute(listRoute, { url: listUrl(from, to), cookie })).status).toBe(400);
  });

  it("42일은 받는다", async () => {
    const { cookie } = await loginAs("FRONT");
    expect((await callRoute(listRoute, { url: listUrl("2026-11-01", "2026-12-12"), cookie })).status).toBe(200);
  });
});

describe("GET /api/appointments/[id]", () => {
  it("예약과 상태 이력(입력자 이름 포함)을 돌려주고 감사 행을 남긴다", async () => {
    const { cookie, staff } = await loginAs("FRONT", { name: "가상프론트" });
    const p = await createPatient({ name: "가상두리", ...sealPhone("010-0123-4567") });
    const created = await create(cookie, body(p.id));
    const id = created.json.appointment.id as string;

    const res = await callRoute(getDetail, { url: `/api/appointments/${id}`, cookie, params: { id } });
    expect(res.status).toBe(200);
    expect(res.json.appointment).toMatchObject({ id, patientId: p.id, patientNameMasked: "가**리", status: "BOOKED" });
    expect(res.json.appointment.history).toEqual([
      expect.objectContaining({ fromStatus: null, toStatus: "BOOKED", reasonCode: null, staffName: "가상프론트" }),
    ]);
    expect(res.text).not.toContain("가상두리");
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "APPOINTMENT_READ" } });
    expect(audit).toMatchObject({ staffId: staff.id, patientId: p.id, result: "SUCCESS" });
  });

  it("없는 예약 → 404", async () => {
    const { cookie } = await loginAs("FRONT");
    const id = "0190f0f0-0000-7000-8000-000000000000";
    expect((await callRoute(getDetail, { url: `/api/appointments/${id}`, cookie, params: { id } })).status).toBe(404);
  });
});

describe("PATCH /api/appointments/[id]/move", () => {
  async function setup() {
    const login = await loginAs("FRONT");
    const p = await fakePatient();
    const created = await create(login.cookie, body(p.id));
    return { ...login, patientId: p.id, id: created.json.appointment.id as string };
  }
  const move = (cookie: string, id: string, payload: Record<string, unknown>) =>
    callRoute(moveRoute, { method: "PATCH", url: `/api/appointments/${id}/move`, cookie, params: { id }, body: payload });

  it("시간·체어·소요시간을 바꾸고 상태 이력은 쓰지 않으며, 감사 행에 이전·이후 시각을 남긴다", async () => {
    const { cookie, id, patientId } = await setup();
    const res = await move(cookie, id, { startAt: at("14:00"), chair: "C3", durationMin: 60 });
    expect(res.status).toBe(200);
    expect(res.json.appointment).toMatchObject({
      startAt: at("14:00"),
      endAt: at("15:00"),
      chair: "C3",
      durationMin: 60,
      status: "BOOKED",
    });
    expect(await db.visitStatusLog.count({ where: { appointmentId: id } })).toBe(1);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "APPOINTMENT_MOVE" } });
    expect(audit).toMatchObject({ patientId, result: "SUCCESS" });
    expect(audit.detail).toMatchObject({ fromStartAt: at("10:00"), toStartAt: at("14:00"), chair: "C3" });
  });

  it("같은 체어에서 자기 자리와 겹치게 조금 옮기는 것은 된다", async () => {
    const { cookie, id } = await setup();
    expect((await move(cookie, id, { startAt: at("10:15") })).status).toBe(200);
  });

  it("다른 날짜(지난 날 포함)로는 옮길 수 없다 — 날짜 변경은 예약변경(400 USE_RESCHEDULE)", async () => {
    const { cookie, id } = await setup();
    const yesterday = kstDateTime(addDays(kstDateKey(new Date()), -1), "10:00").toISOString();
    const res = await move(cookie, id, { startAt: yesterday });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("USE_RESCHEDULE");
  });

  it("대기 상태가 아닌 예약은 옮길 수 없다", async () => {
    const { cookie } = await loginAs("FRONT");
    const p = await fakePatient();
    const row = await insertAppointmentRow({ patientId: p.id, startAt: new Date(at("10:00")), status: "ARRIVED" });
    const res = await move(cookie, row.id, { startAt: at("11:00") });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("INVALID_STATUS");
  });

  it("없는 체어·잘못된 소요시간·5분 단위가 아닌 시각 → 400", async () => {
    const { cookie, id } = await setup();
    expect((await move(cookie, id, { startAt: at("11:00"), chair: "C9" })).status).toBe(400);
    expect((await move(cookie, id, { startAt: at("11:00"), durationMin: 7 })).status).toBe(400);
    expect((await move(cookie, id, { startAt: at("11:01") })).status).toBe(400);
  });

  it("의사는 옮길 수 없다 (403)", async () => {
    const { id } = await setup();
    const { cookie } = await loginAs("DOCTOR");
    expect((await move(cookie, id, { startAt: at("11:00") })).status).toBe(403);
  });
});

describe("GET /api/settings", () => {
  it("병원 설정을 돌려준다", async () => {
    const { cookie } = await loginAs("DOCTOR");
    const res = await callRoute(settingsRoute, { url: "/api/settings", cookie });
    expect(res.status).toBe(200);
    // 부서별 첫 화면(S-4)도 함께 온다 — 설정 행 기본값(첫 설치 값)
    expect(res.json).toEqual({ ...DEFAULT_CLINIC_SETTINGS, departmentHomes: INITIAL_DEPARTMENT_HOMES });
  });

  it("설정 행이 없으면 500과 안내 문구", async () => {
    await db.clinicSetting.deleteMany();
    const { cookie } = await loginAs("FRONT");
    const res = await callRoute(settingsRoute, { url: "/api/settings", cookie });
    expect(res.status).toBe(500);
    expect(res.json.error).toEqual({ code: "SETTINGS_MISSING", message: "병원 설정이 없습니다. npm run db:seed" });
  });
});
