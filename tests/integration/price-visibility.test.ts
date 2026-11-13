/**
 * 확장 계획 S-3 — 예약 금액(단가·할인율)은 appointment.price 권한이 있는 사람만 보고 고친다.
 * - 권한 없는 사람이 부르는 모든 조회 API(와 예약을 돌려주는 쓰기 API)의 응답에 금액 항목이 없다.
 * - 권한 없는 사람은 할인율·단가를 바꿀 수 없다. 보내지 않은 금액 값은 기존 값을 유지한다.
 * 새 조회 API를 만들면 GET_CALLS에 더해야 한다(아래 "모든 GET 라우트를 부른다" 테스트가 빠진 것을 잡는다).
 */
import { randomBytes } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as surgeryNoteGet } from "@/app/api/appointments/[id]/surgery-note/route";
import { PATCH as moveRoute } from "@/app/api/appointments/[id]/move/route";
import { POST as rescheduleRoute } from "@/app/api/appointments/[id]/reschedule/route";
import { POST as revertRoute } from "@/app/api/appointments/[id]/revert/route";
import { GET as detailRoute, PATCH as editRoute } from "@/app/api/appointments/[id]/route";
import { POST as statusRoute } from "@/app/api/appointments/[id]/status/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/appointments/route";
import { GET as meRoute } from "@/app/api/auth/me/route";
import { GET as boardRoute } from "@/app/api/board/route";
import { POST as bookRoute } from "@/app/api/consultations/[id]/book/route";
import { GET as consultDetailRoute } from "@/app/api/consultations/[id]/route";
import { GET as consultListRoute, POST as consultCreateRoute } from "@/app/api/consultations/route";
import { GET as consultStatsRoute } from "@/app/api/consultations/stats/route";
import { GET as healthRoute } from "@/app/api/health/route";
import { POST as importRoute } from "@/app/api/import/[kind]/route";
import { GET as patientDetailRoute } from "@/app/api/patients/[id]/route";
import { POST as patientCreateRoute, GET as patientSearchRoute } from "@/app/api/patients/route";
import { GET as calendarStyleRoute } from "@/app/api/settings/calendar-style/route";
import { GET as consultOutcomesRoute } from "@/app/api/settings/consult-outcomes/route";
import { GET as settingsRoute } from "@/app/api/settings/route";
import { PUT as itemsRoute } from "@/app/api/settings/treatment-items/route";
import { GET as staffAccountsRoute } from "@/app/api/staff/accounts/route";
import { GET as staffRoute } from "@/app/api/staff/route";
import { GET as performanceRoute } from "@/app/api/stats/performance/route";
import { GET as statsRoute } from "@/app/api/stats/route";
import { DEFAULT_CLINIC_SETTINGS } from "@/lib/domain/clinic";
import { addDays, kstDateKey, kstDateTime } from "@/lib/time/kst";
import type { RouteHandler } from "@/server/api/define-route";
import { callRoute, loginAs } from "./helpers/api";
import { createAppointment, createPatient, db, resetDb } from "./helpers";

beforeAll(() => {
  process.env.PII_ENC_KEY = randomBytes(32).toString("base64");
  process.env.PII_HMAC_KEY = randomBytes(32).toString("base64");
});

const TODAY = kstDateKey(new Date());
const DAY = addDays(TODAY, 7);
const FROM = addDays(TODAY, -30);
const TO = addDays(TODAY, 30);

/** 금액을 담는 항목 이름. 금액 권한이 없으면 응답 어디에도(중첩 포함) 있으면 안 된다. */
const PRICE_KEYS = ["listPrice", "discountRate", "price", "amount"];

function priceKeysIn(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => priceKeysIn(v, `${path}[${i}]`));
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, v]) => [
    ...(PRICE_KEYS.includes(key) ? [`${path}.${key}`] : []),
    ...priceKeysIn(v, `${path}.${key}`),
  ]);
}

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

/** 금액 권한만 빼고 모든 조회 권한을 가진 사람 (프론트 + 추가 권한) */
async function readerWithoutPrice() {
  return loginAs("FRONT", {
    extraPermissions: ["stats.read", "consult.read", "consult.write", "surgery.note", "staff.manage", "data.import", "settings.write"],
  });
}

/** 조회 API가 쓸 데이터: 할인율이 있는 고가 예약, 그 예약에 연결된 상담 */
async function scenario() {
  // 목록·상세가 번호를 복호화하므로 API로 등록한다(암호화된 번호)
  const registrar = await loginAs("FRONT");
  const registered = await callRoute(patientCreateRoute, {
    method: "POST",
    url: "/api/patients",
    cookie: registrar.cookie,
    body: { name: "가상금액", phone: "010-0300-0001", visitType: "NEW" },
  });
  expect(registered.status).toBe(201);
  const patient = { id: registered.json.id as string };
  const appointment = await createAppointment({
    patientId: patient.id,
    startAt: kstDateTime(TODAY, "10:00"),
    treatmentItem: "임플란트",
    listPrice: 1_200_000,
    discountRate: 10,
    status: "LEFT",
  });
  const counselor = await loginAs("COUNSELOR");
  const consultation = await db.consultation.create({
    data: {
      patientId: patient.id,
      counselorId: counselor.staff.id,
      consultedAt: kstDateTime(TODAY, "09:00"),
      content: "가상 상담 내용",
      interestedItems: ["임플란트"],
      appointmentId: appointment.id,
    },
  });
  return { patient, appointment, consultation };
}

type Call = { route: RouteHandler; file: string; url: (ids: Awaited<ReturnType<typeof scenario>>) => string; params?: (ids: Awaited<ReturnType<typeof scenario>>) => Record<string, string> };

/** 모든 GET 라우트 (src/app/api 기준 파일 경로) */
const GET_CALLS: Call[] = [
  { file: "appointments/route.ts", route: listRoute, url: () => `/api/appointments?from=${TODAY}&to=${TODAY}` },
  { file: "appointments/[id]/route.ts", route: detailRoute, url: (s) => `/api/appointments/${s.appointment.id}`, params: (s) => ({ id: s.appointment.id }) },
  { file: "appointments/[id]/surgery-note/route.ts", route: surgeryNoteGet, url: (s) => `/api/appointments/${s.appointment.id}/surgery-note`, params: (s) => ({ id: s.appointment.id }) },
  { file: "auth/me/route.ts", route: meRoute, url: () => "/api/auth/me" },
  { file: "board/route.ts", route: boardRoute, url: () => `/api/board?date=${TODAY}` },
  { file: "consultations/route.ts", route: consultListRoute, url: () => `/api/consultations?date=${TODAY}` },
  { file: "consultations/[id]/route.ts", route: consultDetailRoute, url: (s) => `/api/consultations/${s.consultation.id}`, params: (s) => ({ id: s.consultation.id }) },
  { file: "consultations/stats/route.ts", route: consultStatsRoute, url: () => `/api/consultations/stats?from=${FROM}&to=${TODAY}` },
  { file: "health/route.ts", route: healthRoute, url: () => "/api/health" },
  { file: "patients/route.ts", route: patientSearchRoute, url: () => "/api/patients?q=" },
  { file: "patients/[id]/route.ts", route: patientDetailRoute, url: (s) => `/api/patients/${s.patient.id}`, params: (s) => ({ id: s.patient.id }) },
  { file: "settings/route.ts", route: settingsRoute, url: () => "/api/settings" },
  { file: "settings/calendar-style/route.ts", route: calendarStyleRoute, url: () => "/api/settings/calendar-style" },
  { file: "settings/consult-outcomes/route.ts", route: consultOutcomesRoute, url: () => "/api/settings/consult-outcomes" },
  { file: "staff/route.ts", route: staffRoute, url: () => "/api/staff" },
  { file: "staff/accounts/route.ts", route: staffAccountsRoute, url: () => "/api/staff/accounts" },
  { file: "stats/route.ts", route: statsRoute, url: () => `/api/stats?from=${FROM}&to=${TODAY}&unit=day` },
  { file: "stats/performance/route.ts", route: performanceRoute, url: () => `/api/stats/performance?from=${FROM}&to=${TO}` },
];

function getRouteFiles(dir = join(process.cwd(), "src/app/api")): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return getRouteFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

describe("금액 권한이 없으면 응답에 금액이 없다", () => {
  it("모든 GET 라우트를 부른다 (새 조회 API가 빠지면 실패)", async () => {
    const { readFileSync } = await import("node:fs");
    const root = join(process.cwd(), "src/app/api");
    const withGet = getRouteFiles()
      .filter((file) => /export const GET\b/.test(readFileSync(file, "utf8")))
      .map((file) => relative(root, file))
      .sort();
    expect(GET_CALLS.map((c) => c.file).sort()).toEqual(withGet);
  });

  it("모든 조회 API: 200이고 응답 어디에도 단가·할인율·금액 항목이 없다", async () => {
    const s = await scenario();
    const viewer = await readerWithoutPrice();
    for (const call of GET_CALLS) {
      const res = await callRoute(call.route, { url: call.url(s), cookie: viewer.cookie, params: call.params?.(s) });
      expect(res.status, call.file).toBe(200);
      expect(priceKeysIn(res.json), call.file).toEqual([]);
    }
  });

  it("직무 그대로(프론트·간호·추가 권한 없는 의사)도 예약 상세·설정에 금액이 없다", async () => {
    const s = await scenario();
    for (const who of [await loginAs("FRONT"), await loginAs("NURSE"), await loginAs("DOCTOR", { extraPermissions: [] })]) {
      for (const call of GET_CALLS.filter((c) => ["appointments/[id]/route.ts", "settings/route.ts", "appointments/route.ts"].includes(c.file))) {
        const res = await callRoute(call.route, { url: call.url(s), cookie: who.cookie, params: call.params?.(s) });
        expect(res.status).toBe(200);
        expect(priceKeysIn(res.json), `${who.staff.role} ${call.file}`).toEqual([]);
      }
    }
  });

  it("예약을 돌려주는 쓰기 API(등록·이동·상태 변경·되돌리기·예약변경·상담→수술예약·가져오기)에도 금액이 없다", async () => {
    const viewer = await readerWithoutPrice();
    const patient = await createPatient();
    const created = await callRoute(createRoute, {
      method: "POST",
      url: "/api/appointments",
      cookie: viewer.cookie,
      body: { patientId: patient.id, startAt: kstDateTime(DAY, "10:00").toISOString(), durationMin: 30, chair: "C1", treatmentItem: "임플란트", channel: "PHONE" },
    });
    expect(created.status).toBe(201);
    const id = created.json.appointment.id as string;
    const responses = [created];

    responses.push(
      await callRoute(moveRoute, { method: "PATCH", url: `/api/appointments/${id}/move`, cookie: viewer.cookie, params: { id }, body: { startAt: kstDateTime(DAY, "11:00").toISOString() } }),
    );
    responses.push(
      await callRoute(rescheduleRoute, {
        method: "POST",
        url: `/api/appointments/${id}/reschedule`,
        cookie: viewer.cookie,
        params: { id },
        body: { startAt: kstDateTime(addDays(DAY, 1), "10:00").toISOString(), expectedStatus: "BOOKED" },
      }),
    );

    const today = await createAppointment({ patientId: patient.id, startAt: kstDateTime(TODAY, "09:00"), listPrice: 50_000, discountRate: 5 });
    const params = { id: today.id };
    responses.push(
      await callRoute(statusRoute, { method: "POST", url: `/api/appointments/${today.id}/status`, cookie: viewer.cookie, params, body: { to: "ARRIVED", expectedStatus: "BOOKED" } }),
    );
    responses.push(
      await callRoute(revertRoute, { method: "POST", url: `/api/appointments/${today.id}/revert`, cookie: viewer.cookie, params, body: { expectedStatus: "ARRIVED" } }),
    );

    const consultation = (
      await callRoute(consultCreateRoute, {
        method: "POST",
        url: "/api/consultations",
        cookie: viewer.cookie,
        body: { patientId: patient.id, counselorId: (await loginAs("COUNSELOR")).staff.id, consultedAt: kstDateTime(TODAY, "08:00").toISOString(), content: "가상 상담", interestedItems: ["임플란트"], consentObtained: true },
      })
    ).json.id as string;
    responses.push(
      await callRoute(bookRoute, {
        method: "POST",
        url: `/api/consultations/${consultation}/book`,
        cookie: viewer.cookie,
        params: { id: consultation },
        body: { startAt: kstDateTime(addDays(DAY, 2), "10:00").toISOString(), durationMin: 60, chair: "C1", treatmentItem: "임플란트" },
      }),
    );
    responses.push(
      await callRoute(importRoute, {
        method: "POST",
        url: "/api/import/appointments",
        cookie: viewer.cookie,
        params: { kind: "appointments" },
        body: { dryRun: true, firstRow: 2, rows: [{ chartNo: "X1", date: TODAY, time: "10:00", item: "임플란트", status: "예약" }] },
      }),
    );

    for (const res of responses) {
      expect([200, 201], JSON.stringify(res.json).slice(0, 200)).toContain(res.status);
      expect(priceKeysIn(res.json)).toEqual([]);
    }
  });
});

describe("금액 권한이 있으면 본다 (상담·관리자·원장)", () => {
  it("예약 상세·설정·실적에 금액이 있다", async () => {
    const s = await scenario();
    for (const who of [await loginAs("COUNSELOR"), await loginAs("ADMIN"), await loginAs("DOCTOR")]) {
      const detail = await callRoute(detailRoute, { url: `/api/appointments/${s.appointment.id}`, cookie: who.cookie, params: { id: s.appointment.id } });
      expect(detail.json.appointment, who.staff.role).toMatchObject({ listPrice: 1_200_000, discountRate: 10 });
      const settings = await callRoute(settingsRoute, { url: "/api/settings", cookie: who.cookie });
      expect(settings.json.treatmentItemMeta["임플란트"].price).toBe(1_200_000);
    }
    const director = await loginAs("DOCTOR"); // DIRECTOR_EXTRA_PERMISSIONS
    const perf = await callRoute(performanceRoute, { url: `/api/stats/performance?from=${FROM}&to=${TO}`, cookie: director.cookie });
    expect(priceKeysIn(perf.json).length).toBeGreaterThan(0);
  });
});

describe("금액 권한이 없으면 고칠 수 없고, 보내지 않은 금액은 그대로", () => {
  it("할인율을 바꾸는 요청은 403이고 DB는 그대로", async () => {
    const s = await scenario();
    const front = await loginAs("FRONT");
    const res = await callRoute(editRoute, { method: "PATCH", url: `/api/appointments/${s.appointment.id}`, cookie: front.cookie, params: { id: s.appointment.id }, body: { discountRate: 50 } });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe("PRICE_FORBIDDEN");
    expect(await db.appointment.findUniqueOrThrow({ where: { id: s.appointment.id } })).toMatchObject({ discountRate: 10, listPrice: 1_200_000 });
  });

  it("메모·체어만 고치면 단가·할인율이 유지된다", async () => {
    const s = await scenario();
    const future = await createAppointment({ patientId: s.patient.id, startAt: kstDateTime(DAY, "13:00"), treatmentItem: "임플란트", listPrice: 1_000_000, discountRate: 15 });
    const front = await loginAs("FRONT");
    const res = await callRoute(editRoute, { method: "PATCH", url: `/api/appointments/${future.id}`, cookie: front.cookie, params: { id: future.id }, body: { memo: "가상 메모", chair: "C2" } });
    expect(res.status).toBe(200);
    expect(await db.appointment.findUniqueOrThrow({ where: { id: future.id } })).toMatchObject({ memo: "가상 메모", chair: "C2", listPrice: 1_000_000, discountRate: 15 });
  });

  it("예약 항목 편집: 금액 권한 없이 단가를 보내면 403, 단가를 빼고 보내면 기존 단가 유지(새 항목은 0원)", async () => {
    const editor = await loginAs("FRONT", { extraPermissions: ["settings.write"] });
    const meta = DEFAULT_CLINIC_SETTINGS.treatmentItemMeta;
    const items = DEFAULT_CLINIC_SETTINGS.treatmentItems.map((name) => ({ name, category: meta[name]?.category ?? "GENERAL" }));
    const put = (body: unknown) => callRoute(itemsRoute, { method: "PUT", url: "/api/settings/treatment-items", cookie: editor.cookie, body });

    const withPrice = await put({ items: items.map((item) => ({ ...item, price: 1 })) });
    expect(withPrice.status).toBe(403);
    expect(withPrice.json.error.code).toBe("PRICE_FORBIDDEN");

    const ok = await put({ items: [...items, { name: "가상신규항목", category: "GENERAL" }] });
    expect(ok.status).toBe(200);
    expect(priceKeysIn(ok.json)).toEqual([]);
    const saved = (await db.clinicSetting.findUniqueOrThrow({ where: { id: 1 } })).treatmentItemMeta as Record<string, { price: number }>;
    expect(saved["임플란트"].price).toBe(meta["임플란트"].price);
    expect(saved["가상신규항목"].price).toBe(0);
  });
});
