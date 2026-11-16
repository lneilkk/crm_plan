/**
 * F-4 신환·구환 — 이름+번호가 같으면 기존 고객(구환)으로 연결, 내원하면 자동으로 구환, 신환 목록에서 빠짐.
 */
import { randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getOne } from "@/app/api/patients/[id]/route";
import { GET as search, POST } from "@/app/api/patients/route";
import { GET as listAppointments } from "@/app/api/appointments/route";
import { addDays, kstDateKey, kstDateTime } from "@/lib/time/kst";
import { sealPhone } from "@/server/crypto/pii";
import { callRoute, loginAs } from "./helpers/api";
import { createAppointment, createPatient, db, resetDb } from "./helpers";

beforeAll(() => {
  process.env.PII_ENC_KEY = randomBytes(32).toString("base64");
  process.env.PII_HMAC_KEY = randomBytes(32).toString("base64");
});
beforeEach(resetDb);

const PHONE = "010-0123-4567";

function register(cookie: string, body: Record<string, unknown>) {
  return callRoute(POST, { method: "POST", url: "/api/patients", cookie, body });
}

describe("등록: 이름+번호가 같으면 기존 고객(구환)으로 연결", () => {
  it("같은 이름·같은 번호로 다시 등록하면 새로 만들지 않고 409 EXISTING_PATIENT로 기존 고객을 알려 준다(그래도 등록이어도)", async () => {
    const { cookie } = await loginAs("FRONT");
    const first = await register(cookie, { name: "가상환자", phone: PHONE });
    expect(first.status).toBe(201);

    for (const body of [
      { name: "가상환자", phone: "010 0123 4567" },
      { name: " 가상 환자 ", phone: "+82 10-0123-4567", confirmDuplicate: true },
    ]) {
      const res = await register(cookie, body);
      expect(res.status).toBe(409);
      expect(res.json.error.code).toBe("EXISTING_PATIENT");
      expect(res.json.error.existing).toEqual({ id: first.json.id, nameMasked: "가**자" });
      expect(res.text).not.toContain("가상환자");
    }
    expect(await db.patient.count()).toBe(1);
    const audits = await db.auditLog.findMany({ where: { action: "PATIENT_CREATE", result: "FAILED" } });
    expect(audits.every((a) => a.patientId === first.json.id)).toBe(true);
  });

  it("번호만 같고 이름이 다르면(가족 등) 지금처럼 같은 번호 경고 후 그래도 등록할 수 있다", async () => {
    const { cookie } = await loginAs("FRONT");
    await register(cookie, { name: "가상환자", phone: PHONE });
    const warn = await register(cookie, { name: "가상가족", phone: PHONE });
    expect(warn.json.error.code).toBe("DUPLICATE_PHONE");
    expect((await register(cookie, { name: "가상가족", phone: PHONE, confirmDuplicate: true })).status).toBe(201);
  });
});

describe("판정: 내원하면 자동으로 구환", () => {
  it("고객 목록·상세: 신환으로 등록했어도 내원 기록이 생기면 구환, 구환으로 등록한 고객은 처음부터 구환", async () => {
    const { cookie } = await loginAs("FRONT");
    const fresh = await createPatient({ ...sealPhone("010-0111-0001"), name: "가상신환", visitType: "NEW" });
    const visited = await createPatient({ ...sealPhone("010-0111-0002"), name: "가상내원", visitType: "NEW" });
    const imported = await createPatient({ ...sealPhone("010-0111-0003"), name: "가상구환", visitType: "RETURNING" });
    await createAppointment({ patientId: visited.id, status: "ARRIVED", arrivedAt: new Date() });

    const res = await callRoute(search, { url: "/api/patients?q=가상", cookie });
    const byId = new Map(res.json.items.map((item: { id: string; isNewPatient: boolean }) => [item.id, item.isNewPatient]));
    expect(byId.get(fresh.id)).toBe(true);
    expect(byId.get(visited.id)).toBe(false);
    expect(byId.get(imported.id)).toBe(false);

    const detail = await callRoute(getOne, { url: `/api/patients/${visited.id}`, cookie, params: { id: visited.id } });
    expect(detail.json.patient.isNewPatient).toBe(false);
  });

  it("신환만 보기(newOnly=1)에는 내원한 고객과 구환이 빠진다", async () => {
    const { cookie } = await loginAs("FRONT");
    const fresh = await createPatient({ ...sealPhone("010-0111-0001"), name: "가상신환", visitType: "NEW" });
    const visited = await createPatient({ ...sealPhone("010-0111-0002"), name: "가상내원", visitType: "NEW" });
    await createPatient({ ...sealPhone("010-0111-0003"), name: "가상구환", visitType: "RETURNING" });
    await createAppointment({ patientId: visited.id, status: "LEFT", arrivedAt: new Date() });
    await createAppointment({ patientId: fresh.id, status: "NO_SHOW" }); // 노쇼는 내원이 아니다

    const res = await callRoute(search, { url: "/api/patients?q=&newOnly=1", cookie });
    expect(res.json.items.map((item: { id: string }) => item.id)).toEqual([fresh.id]);
  });

  it("예약 목록: 첫 내원 예약은 신환, 그 뒤 예약은 구환", async () => {
    const { cookie } = await loginAs("FRONT");
    const patient = await createPatient({ visitType: "NEW" });
    const day = addDays(kstDateKey(new Date()), 3);
    const firstVisit = await createAppointment({
      patientId: patient.id,
      startAt: kstDateTime(day, "10:00"),
      status: "ARRIVED",
      arrivedAt: kstDateTime(day, "10:00"),
    });
    const next = await createAppointment({ patientId: patient.id, startAt: kstDateTime(day, "15:00"), chair: "C2" });

    const res = await callRoute(listAppointments, { url: `/api/appointments?from=${day}&to=${day}`, cookie });
    const byId = new Map(res.json.items.map((item: { id: string; isNewPatient: boolean }) => [item.id, item.isNewPatient]));
    expect(byId.get(firstVisit.id)).toBe(true);
    expect(byId.get(next.id)).toBe(false);
  });
});
