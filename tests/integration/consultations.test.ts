/**
 * F-10 상담 탭 — T6-1(민감정보 동의가 있는 고객만 저장, 프론트는 상담 내용 열람 불가), T6-2(상담 → 예약 전환, 상담자별 전환율).
 */
import { randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as listRoute, POST as createRoute } from "@/app/api/consultations/route";
import { GET as detailRoute, PATCH as patchRoute } from "@/app/api/consultations/[id]/route";
import { POST as bookRoute } from "@/app/api/consultations/[id]/book/route";
import { GET as statsRoute } from "@/app/api/consultations/stats/route";
import { PUT as outcomesRoute } from "@/app/api/settings/consult-outcomes/route";
import { GET as performanceRoute } from "@/app/api/stats/performance/route";
import { DEFAULT_CLINIC_SETTINGS } from "@/lib/domain/clinic";
import { addDays, kstDateKey, kstDateTime } from "@/lib/time/kst";
import { callRoute, loginAs } from "./helpers/api";
import { createAppointment, createPatient, db, resetDb } from "./helpers";

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
const CONTENT = "임플란트 두 개 상담, 비용 안내";

function create(cookie: string, body: Record<string, unknown>) {
  return callRoute(createRoute, { method: "POST", url: "/api/consultations", cookie, body });
}

async function setup() {
  const counselor = await loginAs("COUNSELOR");
  const patient = await createPatient({ visitType: "NEW" });
  const base = { patientId: patient.id, counselorId: counselor.staff.id, consultedAt: kstDateTime(TODAY, "10:00").toISOString(), content: CONTENT, interestedItems: ["임플란트"] };
  return { counselor, patient, base };
}

describe("T6-1 등록과 민감정보 동의", () => {
  it("동의 기록이 없으면 409 CONSENT_REQUIRED로 저장하지 않고, '동의 받음'이면 동의 기록과 함께 저장", async () => {
    const { counselor, base } = await setup();
    const denied = await create(counselor.cookie, base);
    expect(denied.status).toBe(409);
    expect(denied.json.error.code).toBe("CONSENT_REQUIRED");
    expect(await db.consultation.count()).toBe(0);

    const ok = await create(counselor.cookie, { ...base, consentObtained: true });
    expect(ok.status).toBe(201);
    expect(await db.consent.count({ where: { type: "SENSITIVE", agreed: true } })).toBe(1);
    const row = await db.consultation.findUniqueOrThrow({ where: { id: ok.json.id } });
    expect(row).toMatchObject({ outcome: "대기", result: "PENDING", isNewPatient: true, content: CONTENT });
    // 두 번째부터는 동의 기록이 있어 체크 없이 된다
    expect((await create(counselor.cookie, { ...base, consultedAt: kstDateTime(TODAY, "11:00").toISOString() })).status).toBe(201);
    const audits = JSON.stringify(await db.auditLog.findMany({ where: { action: "CONSULT_CREATE" } }));
    expect(audits).not.toContain("임플란트 두 개");
  });

  it("동의를 철회한 고객은 다시 동의를 받아야 한다", async () => {
    const { counselor, patient, base } = await setup();
    await db.consent.create({ data: { patientId: patient.id, type: "SENSITIVE", agreed: true, agreedAt: new Date(), withdrawnAt: new Date() } });
    expect((await create(counselor.cookie, base)).json.error.code).toBe("CONSENT_REQUIRED");
  });

  it("프론트·간호는 상담 목록·내용을 볼 수 없고 등록도 못 한다(403). 의사는 보기만", async () => {
    const { counselor, base } = await setup();
    const id = (await create(counselor.cookie, { ...base, consentObtained: true })).json.id;
    for (const role of ["FRONT", "NURSE"] as const) {
      const { cookie } = await loginAs(role);
      expect((await callRoute(listRoute, { url: `/api/consultations?date=${TODAY}`, cookie })).status).toBe(403);
      expect((await callRoute(detailRoute, { url: `/api/consultations/${id}`, cookie, params: { id } })).status).toBe(403);
      expect((await create(cookie, { ...base, consentObtained: true })).status).toBe(403);
    }
    const doctor = await loginAs("DOCTOR");
    const detail = await callRoute(detailRoute, { url: `/api/consultations/${id}`, cookie: doctor.cookie, params: { id } });
    expect(detail.json.consultation.content).toBe(CONTENT);
    expect((await create(doctor.cookie, { ...base, consentObtained: true })).status).toBe(403);
  });

  it("목록에는 내용이 없고 이름은 마스킹, 구환은 구환 상담으로 남는다", async () => {
    const { counselor, base } = await setup();
    const returning = await createPatient({ visitType: "RETURNING" });
    await create(counselor.cookie, { ...base, consentObtained: true });
    await create(counselor.cookie, { ...base, patientId: returning.id, consentObtained: true });
    const res = await callRoute(listRoute, { url: `/api/consultations?date=${TODAY}`, cookie: counselor.cookie });
    expect(res.json.items).toHaveLength(2);
    expect(res.text).not.toContain(CONTENT);
    expect(res.json.items.map((i: { isNewPatient: boolean }) => i.isNewPatient).sort()).toEqual([false, true]);
    expect(res.json.outcomes.length).toBeGreaterThan(0);
  });
});

describe("T6-2 상담 → 수술예약 전환", () => {
  it("상담에서 바로 고가 항목 예약을 만들고 연결한다. 결과는 수술예약(BOOKED), 예약의 상담자는 상담자", async () => {
    const { counselor, base } = await setup();
    const id = (await create(counselor.cookie, { ...base, consentObtained: true })).json.id;
    const day = addDays(TODAY, 7);
    const book = (body: Record<string, unknown>) =>
      callRoute(bookRoute, { method: "POST", url: `/api/consultations/${id}/book`, cookie: counselor.cookie, params: { id }, body });

    const general = await book({ startAt: kstDateTime(day, "10:00").toISOString(), durationMin: 60, chair: "C1", treatmentItem: "스케일링" });
    expect(general.json.error.code).toBe("NOT_SURGERY_ITEM");
    const ok = await book({ startAt: kstDateTime(day, "10:00").toISOString(), durationMin: 60, chair: "C1", treatmentItem: "임플란트" });
    expect(ok.status).toBe(201);
    const appointment = await db.appointment.findUniqueOrThrow({ where: { id: ok.json.appointmentId } });
    expect(appointment).toMatchObject({ counselorId: counselor.staff.id, treatmentItem: "임플란트", status: "BOOKED", listPrice: 1_200_000 });
    expect(await db.consultation.findUniqueOrThrow({ where: { id } })).toMatchObject({ appointmentId: appointment.id, outcome: "수술예약", result: "BOOKED" });
    expect((await book({ startAt: kstDateTime(day, "14:00").toISOString(), durationMin: 60, chair: "C1", treatmentItem: "임플란트" })).json.error.code).toBe("ALREADY_BOOKED");
  });

  it("결과를 일반진료·실패로 바꾸면 미전환, 상담자별 전환율을 계산한다", async () => {
    const { counselor, base } = await setup();
    const other = await loginAs("COUNSELOR");
    const ids: string[] = [];
    for (const [i, who] of [counselor, counselor, counselor, other].entries()) {
      const p = await createPatient();
      ids.push((await create(counselor.cookie, { ...base, patientId: p.id, counselorId: who.staff.id, consultedAt: kstDateTime(TODAY, `1${i}:00`).toISOString(), consentObtained: true })).json.id);
    }
    const setOutcome = (id: string, outcome: string) =>
      callRoute(patchRoute, { method: "PATCH", url: `/api/consultations/${id}`, cookie: counselor.cookie, params: { id }, body: { outcome } });
    expect((await setOutcome(ids[0], "수술예약")).status).toBe(200);
    expect((await setOutcome(ids[1], "일반진료")).status).toBe(200);
    expect((await setOutcome(ids[2], "실패")).status).toBe(200);
    expect((await setOutcome(ids[3], "없는분류")).status).toBe(400);
    expect((await db.consultation.findUniqueOrThrow({ where: { id: ids[1] } })).result).toBe("NOT_BOOKED");

    const stats = await callRoute(statsRoute, { url: `/api/consultations/stats?from=${TODAY}&to=${TODAY}`, cookie: counselor.cookie });
    expect(stats.json.total).toMatchObject({ count: 4, SURGERY: 1, GENERAL: 1, FAILED: 1, PENDING: 1 });
    const mine = stats.json.byCounselor.find((c: { counselorId: string }) => c.counselorId === counselor.staff.id);
    expect(mine).toMatchObject({ count: 3, conversionRate: 1 / 3 });
    expect(stats.text).not.toContain(CONTENT);
  });

  it("상담으로 만든 수술예약이 내원하면 상담자 실적에 잡힌다", async () => {
    const { counselor, patient } = await setup();
    await createAppointment({ patientId: patient.id, counselorId: counselor.staff.id, treatmentItem: "임플란트", listPrice: 1_200_000, status: "LEFT", arrivedAt: new Date(), startAt: kstDateTime(addDays(TODAY, -1), "10:00") });
    const admin = await loginAs("ADMIN");
    const day = addDays(TODAY, -1);
    const res = await callRoute(performanceRoute, { url: `/api/stats/performance?from=${day}&to=${day}`, cookie: admin.cookie });
    expect(res.json.counselors[0]).toMatchObject({ staffId: counselor.staff.id, amount: 1_200_000 });
  });
});

describe("상담 결과 분류 설정", () => {
  it("관리자만 저장, '수술예약' 종류가 없거나 이름이 겹치면 400", async () => {
    const counselor = await loginAs("COUNSELOR");
    const outcomes = [{ name: "진행", color: "#123456", kind: "PENDING" }, { name: "수술", color: "#654321", kind: "SURGERY" }];
    expect((await callRoute(outcomesRoute, { method: "PUT", url: "/api/settings/consult-outcomes", cookie: counselor.cookie, body: { outcomes } })).status).toBe(403);
    const admin = await loginAs("ADMIN");
    expect((await callRoute(outcomesRoute, { method: "PUT", url: "/api/settings/consult-outcomes", cookie: admin.cookie, body: { outcomes } })).status).toBe(200);
    expect((await callRoute(outcomesRoute, { method: "PUT", url: "/api/settings/consult-outcomes", cookie: admin.cookie, body: { outcomes: [outcomes[0]] } })).status).toBe(400);
    expect((await callRoute(outcomesRoute, { method: "PUT", url: "/api/settings/consult-outcomes", cookie: admin.cookie, body: { outcomes: [outcomes[1], outcomes[1]] } })).status).toBe(400);
  });
});
