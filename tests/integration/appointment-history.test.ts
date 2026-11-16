/**
 * T4-3 — 예약 변경·취소: 변경 시 원 예약 ID 연결, 사전취소·당일취소 자동 구분.
 * 완료 기준: 변경 이력을 고객 상세에서 추적 가능 — 고객 상세 응답의 예약마다 원 예약·새 예약과 지금 상태로 바꾼 기록(시각·사유·입력자).
 */
import { randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as rescheduleRoute } from "@/app/api/appointments/[id]/reschedule/route";
import { POST as statusRoute } from "@/app/api/appointments/[id]/status/route";
import { GET as patientDetailRoute } from "@/app/api/patients/[id]/route";
import { POST as patientCreateRoute } from "@/app/api/patients/route";
import { DEFAULT_CLINIC_SETTINGS } from "@/lib/domain/clinic";
import { addDays, kstDateKey, kstDateTime } from "@/lib/time/kst";
import { callRoute, loginAs } from "./helpers/api";
import { createAppointment, db, resetDb } from "./helpers";

beforeAll(() => {
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
      treatmentItemMeta: DEFAULT_CLINIC_SETTINGS.treatmentItemMeta,
    },
  });
});

const TODAY = kstDateKey(new Date());
const reschedule = (cookie: string, id: string, startAt: Date, expectedStatus = "BOOKED") =>
  callRoute(rescheduleRoute, { method: "POST", url: `/api/appointments/${id}/reschedule`, cookie, params: { id }, body: { startAt: startAt.toISOString(), expectedStatus } });
const status = (cookie: string, id: string, body: Record<string, unknown>) =>
  callRoute(statusRoute, { method: "POST", url: `/api/appointments/${id}/status`, cookie, params: { id }, body });
/** 고객은 API로 만든다(번호 암호화가 실제와 같아야 상세를 읽을 수 있다). 지어낸 이름·테스트 번호만 */
let seq = 0;
async function createPatient() {
  const { cookie } = await loginAs("FRONT");
  seq += 1;
  const res = await callRoute(patientCreateRoute, { method: "POST", url: "/api/patients", cookie, body: { name: `가상변경${seq}`, phone: `010-0777-${String(1000 + seq)}` } });
  expect(res.status).toBe(201);
  return { id: res.json.patient?.id ?? res.json.id };
}
const detail = (cookie: string, id: string) => callRoute(patientDetailRoute, { url: `/api/patients/${id}`, cookie, params: { id } });

type Item = { id: string; startAt: string; status: string; rescheduledFrom: { id: string; startAt: string } | null; rescheduledTo: { id: string; startAt: string } | null; lastChange: { at: string; reasonCode: string | null; staffName: string } | null };

describe("고객 상세에서 변경 이력 추적", () => {
  it("두 번 예약변경하고 사전취소하면, 고객 상세에서 원 예약 → 새 예약 → 새 예약(사전취소)으로 이어진다", async () => {
    const front = await loginAs("FRONT");
    const patient = await createPatient();
    const a = await createAppointment({ patientId: patient.id, startAt: kstDateTime(addDays(TODAY, 7), "10:00") });
    const toB = await reschedule(front.cookie, a.id, kstDateTime(addDays(TODAY, 8), "11:00"));
    expect(toB.status).toBe(200);
    const b = toB.json.appointment.id as string;
    const toC = await reschedule(front.cookie, b, kstDateTime(addDays(TODAY, 9), "14:00"));
    const c = toC.json.appointment.id as string;
    // 예약일 전에 [취소] — 서버가 사전취소로 정한다(사유 필요 없음)
    expect((await status(front.cookie, c, { to: "CANCELED_ADVANCE", expectedStatus: "BOOKED" })).status).toBe(200);

    const res = await detail(front.cookie, patient.id);
    expect(res.status).toBe(200);
    const items = res.json.appointments as Item[];
    const byId = (id: string) => items.find((item) => item.id === id)!;
    expect(byId(a.id)).toMatchObject({ status: "RESCHEDULED", rescheduledFrom: null, rescheduledTo: { id: b } });
    expect(byId(b)).toMatchObject({ status: "RESCHEDULED", rescheduledFrom: { id: a.id }, rescheduledTo: { id: c } });
    expect(byId(c)).toMatchObject({ status: "CANCELED_ADVANCE", rescheduledFrom: { id: b }, rescheduledTo: null });
    expect(byId(c).rescheduledFrom!.startAt).toBe(kstDateTime(addDays(TODAY, 8), "11:00").toISOString());
    // 누가 언제 바꿨는지
    for (const id of [a.id, b, c]) expect(byId(id).lastChange, id).toMatchObject({ staffName: front.staff.name, reasonCode: null });
    expect(Date.parse(byId(c).lastChange!.at)).toBeGreaterThan(Date.now() - 60_000);
  });

  it("당일취소는 사유와 함께 남고, 아직 바꾸지 않은 예약은 등록 기록이 보인다", async () => {
    const front = await loginAs("FRONT");
    const patient = await createPatient();
    const today = await createAppointment({ patientId: patient.id, startAt: kstDateTime(TODAY, "23:00") }); // 언제 돌려도 오늘(한국 시간)
    // 오늘 예약은 사전취소가 아니라 당일취소(사유 필수)
    expect((await status(front.cookie, today.id, { to: "CANCELED_ADVANCE", expectedStatus: "BOOKED" })).status).toBe(400);
    expect((await status(front.cookie, today.id, { to: "CANCELED_SAME_DAY", expectedStatus: "BOOKED" })).status).toBe(400);
    expect((await status(front.cookie, today.id, { to: "CANCELED_SAME_DAY", reasonCode: "PERSONAL", expectedStatus: "BOOKED" })).status).toBe(200);
    const items = (await detail(front.cookie, patient.id)).json.appointments as Item[];
    expect(items[0]).toMatchObject({ status: "CANCELED_SAME_DAY", lastChange: { reasonCode: "PERSONAL", staffName: front.staff.name } });
  });

  it("응답에 직원 이름 외의 다른 사람 정보는 없고, 예약을 볼 수 있는 직무는 모두 같은 이력을 본다", async () => {
    const patient = await createPatient();
    await createAppointment({ patientId: patient.id, startAt: kstDateTime(addDays(TODAY, 7), "10:00") });
    for (const role of ["FRONT", "COUNSELOR", "DOCTOR", "NURSE", "ADMIN"] as const) {
      const res = await detail((await loginAs(role)).cookie, patient.id);
      expect(res.status, role).toBe(200);
      expect(res.json.appointments[0], role).toHaveProperty("rescheduledTo", null);
    }
  });
});
