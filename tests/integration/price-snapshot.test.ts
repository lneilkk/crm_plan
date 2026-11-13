/**
 * S-3 보완 — 금액 권한이 없는 프론트가 예약을 만들어도 단가는 서버가 항목 설정에서 가져와 기록한다(0원이 되지 않는다).
 * "단가 미입력" 항목(금액 권한 없이 새로 만든 항목)은 0원과 구분해 null로 저장하고, 실적에서 따로 센다.
 * 관리자가 빠진 단가를 채우면 단가 없이 잡힌 예약에도 그 단가가 채워진다.
 */
import { randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PATCH as editRoute } from "@/app/api/appointments/[id]/route";
import { POST as rescheduleRoute } from "@/app/api/appointments/[id]/reschedule/route";
import { POST as createRoute } from "@/app/api/appointments/route";
import { POST as bookRoute } from "@/app/api/consultations/[id]/book/route";
import { POST as consultCreateRoute } from "@/app/api/consultations/route";
import { GET as settingsRoute } from "@/app/api/settings/route";
import { PUT as itemsRoute } from "@/app/api/settings/treatment-items/route";
import { GET as performanceRoute } from "@/app/api/stats/performance/route";
import { DEFAULT_CLINIC_SETTINGS } from "@/lib/domain/clinic";
import { addDays, kstDateKey, kstDateTime } from "@/lib/time/kst";
import { callRoute, loginAs } from "./helpers/api";
import { createAppointment, createPatient, db, resetDb } from "./helpers";

beforeAll(() => {
  process.env.PII_ENC_KEY = randomBytes(32).toString("base64");
  process.env.PII_HMAC_KEY = randomBytes(32).toString("base64");
});

const TODAY = kstDateKey(new Date());
const DAY = addDays(TODAY, 7);
const IMPLANT = DEFAULT_CLINIC_SETTINGS.treatmentItemMeta["임플란트"].price as number;

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

function create(cookie: string, body: Record<string, unknown>) {
  return callRoute(createRoute, { method: "POST", url: "/api/appointments", cookie, body: { durationMin: 30, chair: "C1", channel: "PHONE", ...body } });
}

const perf = (cookie: string) =>
  callRoute(performanceRoute, { url: `/api/stats/performance?from=${addDays(TODAY, -1)}&to=${addDays(DAY, 3)}`, cookie });

describe("프론트(금액 권한 없음)가 잡은 예약도 단가가 기록된다", () => {
  it("등록: 서버가 항목 설정의 단가를 기록하고, 응답에는 단가가 없다", async () => {
    const front = await loginAs("FRONT");
    const patient = await createPatient();
    const res = await create(front.cookie, { patientId: patient.id, startAt: kstDateTime(DAY, "10:00").toISOString(), treatmentItem: "임플란트" });
    expect(res.status).toBe(201);
    expect(res.json.appointment).not.toHaveProperty("listPrice");
    const saved = await db.appointment.findUniqueOrThrow({ where: { id: res.json.appointment.id } });
    expect(saved.listPrice).toBe(IMPLANT);
    expect(saved.discountRate).toBe(0);
  });

  it("항목 변경·예약변경·상담 → 수술예약도 그 시점 설정 단가", async () => {
    const front = await loginAs("FRONT");
    const patient = await createPatient();
    const id = (await create(front.cookie, { patientId: patient.id, startAt: kstDateTime(DAY, "11:00").toISOString(), treatmentItem: "스케일링" })).json.appointment.id as string;

    expect((await callRoute(editRoute, { method: "PATCH", url: `/api/appointments/${id}`, cookie: front.cookie, params: { id }, body: { treatmentItem: "임플란트" } })).status).toBe(200);
    expect((await db.appointment.findUniqueOrThrow({ where: { id } })).listPrice).toBe(IMPLANT);

    const moved = await callRoute(rescheduleRoute, {
      method: "POST",
      url: `/api/appointments/${id}/reschedule`,
      cookie: front.cookie,
      params: { id },
      body: { startAt: kstDateTime(addDays(DAY, 1), "11:00").toISOString(), expectedStatus: "BOOKED" },
    });
    expect(moved.status).toBe(200);
    expect((await db.appointment.findUniqueOrThrow({ where: { id: moved.json.appointment.id } })).listPrice).toBe(IMPLANT);

    const counselor = await loginAs("COUNSELOR");
    const consult = await callRoute(consultCreateRoute, {
      method: "POST",
      url: "/api/consultations",
      cookie: counselor.cookie,
      body: { patientId: patient.id, counselorId: counselor.staff.id, consultedAt: kstDateTime(TODAY, "09:00").toISOString(), content: "가상 상담", interestedItems: ["라미네이트"], consentObtained: true },
    });
    // 금액 권한 없는 사람이 수술예약을 잡는 경우(간호 + 상담 쓰기 추가 권한)
    const nurse = await loginAs("NURSE", { extraPermissions: ["consult.read", "consult.write"] });
    const cid = consult.json.id as string;
    const booked = await callRoute(bookRoute, {
      method: "POST",
      url: `/api/consultations/${cid}/book`,
      cookie: nurse.cookie,
      params: { id: cid },
      body: { startAt: kstDateTime(addDays(DAY, 2), "10:00").toISOString(), durationMin: 60, chair: "C1", treatmentItem: "라미네이트" },
    });
    expect(booked.status).toBe(201);
    expect((await db.appointment.findUniqueOrThrow({ where: { id: booked.json.appointmentId } })).listPrice).toBe(
      DEFAULT_CLINIC_SETTINGS.treatmentItemMeta["라미네이트"].price,
    );
  });

  it("실적(관리자)에 프론트가 잡은 예약 금액이 들어간다", async () => {
    const front = await loginAs("FRONT");
    const patient = await createPatient();
    const id = (await create(front.cookie, { patientId: patient.id, startAt: kstDateTime(DAY, "10:00").toISOString(), treatmentItem: "임플란트" })).json.appointment.id as string;
    await db.appointment.update({ where: { id }, data: { status: "LEFT" } }); // 내원 완료로 (실적은 내원한 예약만)
    const admin = await loginAs("ADMIN");
    const report = (await perf(admin.cookie)).json;
    const line = report.doctors.flatMap((r: { items: { item: string; amount: number }[] }) => r.items).find((l: { item: string }) => l.item === "임플란트");
    expect(line.amount).toBe(IMPLANT);
  });
});

describe("단가 미입력 (0원과 구분)", () => {
  it("금액 권한 없이 만든 새 항목은 단가 미입력(null) — 관리자에게 null로 보이고, 그 항목 예약도 단가 미입력, 실적에서 따로 센다", async () => {
    const editor = await loginAs("FRONT", { extraPermissions: ["settings.write"] });
    const meta = DEFAULT_CLINIC_SETTINGS.treatmentItemMeta;
    const items = [...DEFAULT_CLINIC_SETTINGS.treatmentItems.map((name) => ({ name, category: meta[name].category })), { name: "가상신규", category: "PREMIUM" }];
    expect((await callRoute(itemsRoute, { method: "PUT", url: "/api/settings/treatment-items", cookie: editor.cookie, body: { items } })).status).toBe(200);

    const admin = await loginAs("ADMIN");
    const settings = (await callRoute(settingsRoute, { url: "/api/settings", cookie: admin.cookie })).json;
    expect(settings.treatmentItemMeta["가상신규"]).toMatchObject({ category: "PREMIUM", price: null });
    expect(settings.treatmentItemMeta["임플란트"].price).toBe(IMPLANT);

    const front = await loginAs("FRONT");
    const patient = await createPatient();
    const id = (await create(front.cookie, { patientId: patient.id, startAt: kstDateTime(DAY, "10:00").toISOString(), treatmentItem: "가상신규" })).json.appointment.id as string;
    expect((await db.appointment.findUniqueOrThrow({ where: { id } })).listPrice).toBeNull();
    await db.appointment.update({ where: { id }, data: { status: "LEFT" } });
    const priced = await createAppointment({ patientId: patient.id, startAt: kstDateTime(DAY, "14:00"), treatmentItem: "임플란트", listPrice: IMPLANT, status: "LEFT" });

    const report = (await perf(admin.cookie)).json;
    expect(report.unpricedVisits).toBe(1);
    const row = report.doctors[0];
    expect(row.unpricedVisits).toBe(1);
    expect(row.amount).toBe(IMPLANT); // 미입력은 금액 합에 들어가지 않는다
    expect(row.items.find((l: { item: string }) => l.item === "가상신규")).toMatchObject({ amount: 0, unpricedVisits: 1 });

    // 금액 권한이 없는 사람에게는 미입력 건수도 없다(금액 관련 항목)
    const viewer = await loginAs("FRONT", { extraPermissions: ["stats.read"] });
    expect(JSON.stringify((await perf(viewer.cookie)).json)).not.toContain("unpricedVisits");

    // 관리자가 단가를 채우면: 먼저 "단가 없이 잡힌 예약 N건에도 적용" 확인을 받는다(확인 없으면 409, 아무것도 바뀌지 않음)
    const filled = items.map((item) => ({ ...item, price: item.name === "가상신규" ? 70_000 : (meta[item.name]?.price ?? 0) }));
    const putItems = (body: unknown) => callRoute(itemsRoute, { method: "PUT", url: "/api/settings/treatment-items", cookie: admin.cookie, body });
    const ask = await putItems({ items: filled });
    expect(ask.status).toBe(409);
    expect(ask.json.error.code).toBe("BACKFILL_CONFIRM_REQUIRED");
    expect(ask.json.error).toMatchObject({ total: 1, items: [{ item: "가상신규", count: 1 }] });
    expect((await db.appointment.findUniqueOrThrow({ where: { id } })).listPrice).toBeNull();
    expect(((await db.clinicSetting.findUniqueOrThrow({ where: { id: 1 } })).treatmentItemMeta as Record<string, { price: number | null }>)["가상신규"].price).toBeNull();

    // 확인하고 저장하면 단가 없이 잡힌 예약에 채워지고, 이미 단가가 있는 예약은 그대로. 누가 몇 건에 적용했는지 감사 로그에 남는다
    expect((await putItems({ items: filled, confirmBackfill: true })).status).toBe(200);
    expect((await db.appointment.findUniqueOrThrow({ where: { id } })).listPrice).toBe(70_000);
    expect((await db.appointment.findUniqueOrThrow({ where: { id: priced.id } })).listPrice).toBe(IMPLANT);
    expect((await perf(admin.cookie)).json.unpricedVisits).toBe(0);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "TREATMENT_ITEMS_UPDATE", result: "SUCCESS" }, orderBy: { createdAt: "desc" } });
    expect(audit.staffId).toBe(admin.staff.id);
    expect(audit.detail).toMatchObject({ backfilledAppointments: 1, backfilledItems: "가상신규:1" });

    // 한 번 채워진 뒤 단가를 바꾸면 지난 예약은 그대로(예약 당시 단가)이고 확인도 필요 없다
    const changed = filled.map((item) => (item.name === "가상신규" ? { ...item, price: 80_000 } : item));
    expect((await putItems({ items: changed })).status).toBe(200);
    expect((await db.appointment.findUniqueOrThrow({ where: { id } })).listPrice).toBe(70_000);
  });

  it("금액 권한이 있는 사람은 단가를 비워(null) 미입력으로 둘 수 있고, 미입력은 0원과 다르다", async () => {
    const admin = await loginAs("ADMIN");
    const meta = DEFAULT_CLINIC_SETTINGS.treatmentItemMeta;
    const items = DEFAULT_CLINIC_SETTINGS.treatmentItems.map((name) => ({ name, category: meta[name].category, price: name === "상담" ? 0 : name === "보철" ? null : meta[name].price }));
    expect((await callRoute(itemsRoute, { method: "PUT", url: "/api/settings/treatment-items", cookie: admin.cookie, body: { items } })).status).toBe(200);
    const saved = (await callRoute(settingsRoute, { url: "/api/settings", cookie: admin.cookie })).json.treatmentItemMeta;
    expect(saved["상담"].price).toBe(0);
    expect(saved["보철"].price).toBeNull();
  });
});
