/**
 * F-5 상담실은 고가 항목만, F-6 단가·할인율·실적, F-8 예약 메모 고치기.
 */
import { randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as createRoute } from "@/app/api/appointments/route";
import { GET as detailRoute, PATCH as editRoute } from "@/app/api/appointments/[id]/route";
import { PATCH as moveRoute } from "@/app/api/appointments/[id]/move/route";
import { PUT as itemsRoute } from "@/app/api/settings/treatment-items/route";
import { GET as performanceRoute } from "@/app/api/stats/performance/route";
import { DEFAULT_CLINIC_SETTINGS } from "@/lib/domain/clinic";
import { addDays, kstDateKey, kstDateTime } from "@/lib/time/kst";
import { callRoute, loginAs } from "./helpers/api";
import { createAppointment, createPatient, createStaff, db, resetDb } from "./helpers";

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
const DAY = addDays(TODAY, 7);
const CONSULT = "R1";

async function book(cookie: string, overrides: Record<string, unknown> = {}) {
  const patient = await createPatient();
  return callRoute(createRoute, {
    method: "POST",
    url: "/api/appointments",
    cookie,
    body: {
      patientId: patient.id,
      startAt: kstDateTime(DAY, "10:00").toISOString(),
      durationMin: 30,
      chair: "C1",
      treatmentItem: "스케일링",
      channel: "PHONE",
      ...overrides,
    },
  });
}

function edit(cookie: string, id: string, body: unknown) {
  return callRoute(editRoute, { method: "PATCH", url: `/api/appointments/${id}`, cookie, params: { id }, body });
}

describe("F-5 상담실에는 고가 항목만", () => {
  it("등록: 상담실에 일반 항목은 400, 고가 항목은 된다. 단가가 예약에 저장된다", async () => {
    const { cookie } = await loginAs("FRONT");
    const bad = await book(cookie, { chair: CONSULT, treatmentItem: "스케일링" });
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe("GENERAL_ITEM_IN_CONSULT_ROOM");
    expect(await db.appointment.count()).toBe(0);

    const ok = await book(cookie, { chair: CONSULT, treatmentItem: "임플란트" });
    expect(ok.status).toBe(201);
    const row = await db.appointment.findUniqueOrThrow({ where: { id: ok.json.appointment.id } });
    expect(row.listPrice).toBe(1_200_000);
    expect(row.discountRate).toBe(0);
  });

  it("이동: 일반 항목 예약을 상담실로 옮기면 400", async () => {
    const { cookie } = await loginAs("FRONT");
    const created = await book(cookie);
    const id = created.json.appointment.id;
    const res = await callRoute(moveRoute, {
      method: "PATCH",
      url: `/api/appointments/${id}/move`,
      cookie,
      params: { id },
      body: { startAt: kstDateTime(DAY, "10:00").toISOString(), chair: CONSULT },
    });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("GENERAL_ITEM_IN_CONSULT_ROOM");
  });

  it("상담 중 일반 진료로 바뀜: 상담실 예약의 항목만 일반으로 바꾸면 400, 진료 체어와 같이 바꾸면 체어 열로 옮겨지고 단가도 바뀐다", async () => {
    const { cookie } = await loginAs("COUNSELOR");
    const created = await book(cookie, { chair: CONSULT, treatmentItem: "임플란트" });
    const id = created.json.appointment.id;

    const onlyItem = await edit(cookie, id, { treatmentItem: "스케일링" });
    expect(onlyItem.status).toBe(400);
    expect(onlyItem.json.error.code).toBe("GENERAL_ITEM_IN_CONSULT_ROOM");

    const moved = await edit(cookie, id, { treatmentItem: "스케일링", chair: "C2" });
    expect(moved.status).toBe(200);
    const row = await db.appointment.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ chair: "C2", treatmentItem: "스케일링", listPrice: 15_000 });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "APPOINTMENT_UPDATE", result: "SUCCESS" } });
    expect(audit.patientId).toBe(row.patientId);
    expect(audit.detail).toMatchObject({ fromChair: CONSULT, toChair: "C2" });
  });

  it("옮길 체어에 이미 예약이 있으면 409 CHAIR_CONFLICT, 아무것도 바뀌지 않는다", async () => {
    const { cookie } = await loginAs("FRONT");
    await book(cookie, { chair: "C2" });
    const consult = await book(cookie, { chair: CONSULT, treatmentItem: "라미네이트" });
    const id = consult.json.appointment.id;
    const res = await edit(cookie, id, { treatmentItem: "스케일링", chair: "C2" });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("CHAIR_CONFLICT");
    expect((await db.appointment.findUniqueOrThrow({ where: { id } })).chair).toBe(CONSULT);
  });
});

describe("F-8 메모·F-6 할인율 고치기", () => {
  it("메모를 추가·수정·지우기, 감사 행에는 메모 내용이 없다. 주민번호 모양은 거부", async () => {
    const { cookie } = await loginAs("FRONT");
    const id = (await book(cookie)).json.appointment.id;
    expect((await edit(cookie, id, { memo: "오후 늦게 도착 예정" })).status).toBe(200);
    const detail = await callRoute(detailRoute, { url: `/api/appointments/${id}`, cookie, params: { id } });
    expect(detail.json.appointment.memo).toBe("오후 늦게 도착 예정");
    expect((await edit(cookie, id, { memo: "  " })).status).toBe(200);
    expect((await db.appointment.findUniqueOrThrow({ where: { id } })).memo).toBeNull();

    const rrn = await edit(cookie, id, { memo: "주민 900101-1234567" });
    expect(rrn.status).toBe(400);
    const audits = JSON.stringify(await db.auditLog.findMany({ where: { action: "APPOINTMENT_UPDATE" } }));
    expect(audits).not.toContain("오후 늦게");
    expect(audits).not.toContain("900101");
  });

  it("지난 날 내원 예약도 메모·할인율은 고칠 수 있지만 항목·체어는 409", async () => {
    // 할인율은 금액 권한(appointment.price)이 있어야 고친다(S-3) — 상담 직무는 기본으로 가진다
    const { cookie } = await loginAs("COUNSELOR");
    const past = await createAppointment({
      startAt: kstDateTime(addDays(TODAY, -3), "10:00"),
      status: "LEFT",
      arrivedAt: kstDateTime(addDays(TODAY, -3), "10:00"),
      treatmentItem: "임플란트",
      listPrice: 1_200_000,
    });
    expect((await edit(cookie, past.id, { discountRate: 10, memo: "가족 할인" })).status).toBe(200);
    expect((await db.appointment.findUniqueOrThrow({ where: { id: past.id } })).discountRate).toBe(10);
    const res = await edit(cookie, past.id, { treatmentItem: "교정" });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("PAST_APPOINTMENT");
  });

  it("할인율은 0~100 정수만, 빈 수정은 400, 의사는 403", async () => {
    const { cookie } = await loginAs("FRONT");
    const id = (await book(cookie)).json.appointment.id;
    for (const discountRate of [-1, 101, 5.5]) expect((await edit(cookie, id, { discountRate })).status).toBe(400);
    expect((await edit(cookie, id, {})).status).toBe(400);
    const doctor = await loginAs("DOCTOR");
    expect((await edit(doctor.cookie, id, { memo: "x" })).status).toBe(403);
  });
});

describe("예약 항목 설정 (PUT /api/settings/treatment-items)", () => {
  it("관리자만 저장, 순서·구분·단가가 저장되고 새 예약 단가에 쓰인다. 지난 예약 단가는 그대로", async () => {
    const front = await loginAs("FRONT");
    const old = (await book(front.cookie, { chair: CONSULT, treatmentItem: "임플란트" })).json.appointment.id;
    expect((await callRoute(itemsRoute, { method: "PUT", url: "/api/settings/treatment-items", cookie: front.cookie, body: { items: [] } })).status).toBe(403);

    const admin = await loginAs("ADMIN");
    const items = [
      { name: "임플란트", category: "PREMIUM", price: 1_500_000 },
      { name: "스케일링", category: "GENERAL", price: 20_000 },
    ];
    const res = await callRoute(itemsRoute, { method: "PUT", url: "/api/settings/treatment-items", cookie: admin.cookie, body: { items } });
    expect(res.status).toBe(200);
    const setting = await db.clinicSetting.findUniqueOrThrow({ where: { id: 1 } });
    expect(setting.treatmentItems).toEqual(["임플란트", "스케일링"]);

    const fresh = await book(front.cookie, { chair: CONSULT, treatmentItem: "임플란트", startAt: kstDateTime(DAY, "11:00").toISOString() });
    expect((await db.appointment.findUniqueOrThrow({ where: { id: fresh.json.appointment.id } })).listPrice).toBe(1_500_000);
    expect((await db.appointment.findUniqueOrThrow({ where: { id: old } })).listPrice).toBe(1_200_000);
  });

  it("같은 이름 두 번, 음수 단가, 빈 목록은 400", async () => {
    const { cookie } = await loginAs("ADMIN");
    for (const items of [
      [{ name: "A", category: "GENERAL", price: 1 }, { name: "A", category: "PREMIUM", price: 2 }],
      [{ name: "A", category: "GENERAL", price: -1 }],
      [],
    ]) {
      expect((await callRoute(itemsRoute, { method: "PUT", url: "/api/settings/treatment-items", cookie, body: { items } })).status).toBe(400);
    }
  });
});

describe("F-6 실적 (GET /api/stats/performance)", () => {
  it("내원한 예약만, 의사·상담자별·항목별 환자 수·방문 수·할인 반영 금액. 환자 정보는 응답에 없다", async () => {
    const doc1 = await createStaff({ role: "DOCTOR", name: "가상의사일" });
    const doc2 = await createStaff({ role: "DOCTOR", name: "가상의사이" });
    const counselor = await createStaff({ role: "COUNSELOR", name: "가상상담" });
    const [p1, p2] = [await createPatient(), await createPatient()];
    const day = addDays(TODAY, -2);
    const at = (time: string) => kstDateTime(day, time);
    const arrived = { status: "LEFT" as const, arrivedAt: at("09:00") };
    let chairNo = 0;
    const mk = (o: Parameters<typeof createAppointment>[0]) => createAppointment({ chair: `C${(chairNo++ % 4) + 1}`, ...o });
    await mk({ patientId: p1.id, startAt: at("09:00"), doctorId: doc1.id, counselorId: counselor.id, treatmentItem: "임플란트", listPrice: 1_200_000, discountRate: 10, ...arrived });
    await mk({ patientId: p2.id, startAt: at("09:00"), doctorId: doc1.id, counselorId: counselor.id, treatmentItem: "임플란트", listPrice: 1_200_000, ...arrived });
    await mk({ patientId: p1.id, startAt: at("09:00"), doctorId: doc1.id, treatmentItem: "라미네이트", listPrice: 600_000, ...arrived });
    await mk({ patientId: p2.id, startAt: at("09:00"), doctorId: doc2.id, treatmentItem: "스케일링", listPrice: 15_000, ...arrived });
    await mk({ patientId: p2.id, startAt: at("11:00"), doctorId: doc2.id, treatmentItem: "임플란트", listPrice: 1_200_000, status: "NO_SHOW" });
    await mk({ patientId: p1.id, startAt: at("11:00"), treatmentItem: "스케일링", listPrice: 15_000, ...arrived });

    for (const role of ["FRONT", "COUNSELOR"] as const) {
      const { cookie } = await loginAs(role);
      expect((await callRoute(performanceRoute, { url: `/api/stats/performance?from=${day}&to=${day}`, cookie })).status).toBe(403);
    }
    const { cookie } = await loginAs("DOCTOR");
    const res = await callRoute(performanceRoute, { url: `/api/stats/performance?from=${day}&to=${day}`, cookie });
    expect(res.status).toBe(200);
    const d1 = res.json.doctors.find((r: { staffId: string }) => r.staffId === doc1.id);
    expect(d1).toMatchObject({ staffName: "가상의사일", patients: 2, visits: 3, amount: 1_080_000 + 1_200_000 + 600_000 });
    expect(d1.items).toEqual([
      { item: "임플란트", patients: 2, visits: 2, amount: 2_280_000 },
      { item: "라미네이트", patients: 1, visits: 1, amount: 600_000 },
    ]);
    const d2 = res.json.doctors.find((r: { staffId: string }) => r.staffId === doc2.id);
    expect(d2).toMatchObject({ patients: 1, visits: 1, amount: 15_000 }); // 노쇼는 빠진다
    expect(res.json.doctors.at(-1)).toMatchObject({ staffId: null, staffName: "미지정", visits: 1 });
    expect(res.json.counselors).toEqual([
      { staffId: counselor.id, staffName: "가상상담", patients: 2, visits: 2, amount: 2_280_000, items: [{ item: "임플란트", patients: 2, visits: 2, amount: 2_280_000 }] },
    ]);
    expect(res.text).not.toContain(p1.id);
    expect(res.text).not.toContain(p1.name);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "STATS_PERFORMANCE_READ", result: "SUCCESS" } });
    expect(audit.detail).toMatchObject({ days: 1, rows: 5 });
  });
});
