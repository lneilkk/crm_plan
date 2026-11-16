/**
 * F-11 수술 기록 — 참여 직원(예약을 보는 직원은 명단을 봄), 수술 메모(원장·관리자만, 조회 감사 로그).
 */
import { randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as detailRoute } from "@/app/api/appointments/[id]/route";
import { PUT as participantsRoute } from "@/app/api/appointments/[id]/participants/route";
import { GET as noteGet, PUT as notePut } from "@/app/api/appointments/[id]/surgery-note/route";
import { GET as listRoute } from "@/app/api/appointments/route";
import { kstDateKey } from "@/lib/time/kst";
import { callRoute, loginAs } from "./helpers/api";
import { createAppointment, createStaff, db, resetDb } from "./helpers";

beforeAll(() => {
  process.env.PII_ENC_KEY = randomBytes(32).toString("base64");
  process.env.PII_HMAC_KEY = randomBytes(32).toString("base64");
});
beforeEach(resetDb);

const NOTE = "봉합 중 기구 전달 순서 착오, 재교육 필요";

describe("수술 참여 직원", () => {
  it("간호가 참여 직원을 기록하고, 예약 상세에 이름·역할이 나온다. 감사 행에는 인원 수와 환자", async () => {
    const appointment = await createAppointment({ treatmentItem: "임플란트" });
    const nurse = await loginAs("NURSE", { name: "가상간호" });
    const doctor = await createStaff({ role: "DOCTOR", name: "가상원장" });
    const res = await callRoute(participantsRoute, {
      method: "PUT",
      url: `/api/appointments/${appointment.id}/participants`,
      cookie: nurse.cookie,
      params: { id: appointment.id },
      body: { staffIds: [nurse.staff.id, doctor.id, nurse.staff.id] },
    });
    expect(res.status).toBe(200);
    const front = await loginAs("FRONT");
    const detail = await callRoute(detailRoute, { url: `/api/appointments/${appointment.id}`, cookie: front.cookie, params: { id: appointment.id } });
    expect(detail.json.appointment.participants.map((p: { name: string; role: string }) => [p.name, p.role]).sort()).toEqual([
      ["가상간호", "NURSE"],
      ["가상원장", "DOCTOR"],
    ]);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "SURGERY_PARTICIPANTS_UPDATE", result: "SUCCESS" } });
    expect(audit).toMatchObject({ patientId: appointment.patientId, detail: expect.objectContaining({ participantCount: 2 }) });

    // 빼기
    await callRoute(participantsRoute, { method: "PUT", url: `/api/appointments/${appointment.id}/participants`, cookie: nurse.cookie, params: { id: appointment.id }, body: { staffIds: [doctor.id] } });
    expect(await db.appointmentParticipant.count({ where: { appointmentId: appointment.id } })).toBe(1);
  });

  it("비활성 직원·없는 직원은 400, 없는 예약은 404", async () => {
    const appointment = await createAppointment();
    const nurse = await loginAs("NURSE");
    const gone = await createStaff({ role: "NURSE", isActive: false });
    const put = (id: string, staffIds: string[]) => callRoute(participantsRoute, { method: "PUT", url: `/api/appointments/${id}/participants`, cookie: nurse.cookie, params: { id }, body: { staffIds } });
    expect((await put(appointment.id, [gone.id])).status).toBe(400);
    expect((await put("01900000-0000-7000-8000-000000000000", [])).status).toBe(404);
  });
});

describe("수술 메모 (원장·관리자만)", () => {
  it("원장이 쓰고 관리자가 본다. 프론트·상담·간호는 403. 감사 행·예약 응답에 내용이 없다", async () => {
    const appointment = await createAppointment({ treatmentItem: "임플란트" });
    const doctor = await loginAs("DOCTOR");
    const put = await callRoute(notePut, { method: "PUT", url: `/api/appointments/${appointment.id}/surgery-note`, cookie: doctor.cookie, params: { id: appointment.id }, body: { content: NOTE } });
    expect(put.status).toBe(200);

    const admin = await loginAs("ADMIN");
    const got = await callRoute(noteGet, { url: `/api/appointments/${appointment.id}/surgery-note`, cookie: admin.cookie, params: { id: appointment.id } });
    expect(got.json.note).toMatchObject({ content: NOTE });

    for (const role of ["FRONT", "COUNSELOR", "NURSE"] as const) {
      const { cookie } = await loginAs(role);
      expect((await callRoute(noteGet, { url: `/api/appointments/${appointment.id}/surgery-note`, cookie, params: { id: appointment.id } })).status).toBe(403);
      expect((await callRoute(notePut, { method: "PUT", url: `/api/appointments/${appointment.id}/surgery-note`, cookie, params: { id: appointment.id }, body: { content: "x" } })).status).toBe(403);
    }
    // 일반 예약 조회에는 메모가 실리지 않는다
    const front = await loginAs("FRONT");
    const detail = await callRoute(detailRoute, { url: `/api/appointments/${appointment.id}`, cookie: front.cookie, params: { id: appointment.id } });
    const day = kstDateKey(appointment.startAt);
    const list = await callRoute(listRoute, { url: `/api/appointments?from=${day}&to=${day}`, cookie: front.cookie });
    for (const text of [detail.text, list.text, JSON.stringify(await db.auditLog.findMany())]) expect(text).not.toContain("기구 전달");
    expect(await db.auditLog.count({ where: { action: "SURGERY_NOTE_READ", result: "SUCCESS" } })).toBe(1);
  });

  it("빈 내용으로 저장하면 지워지고, 주민번호 모양은 거부", async () => {
    const appointment = await createAppointment();
    const doctor = await loginAs("DOCTOR");
    const put = (content: string) => callRoute(notePut, { method: "PUT", url: `/api/appointments/${appointment.id}/surgery-note`, cookie: doctor.cookie, params: { id: appointment.id }, body: { content } });
    await put(NOTE);
    expect((await put("  ")).status).toBe(200);
    expect(await db.surgeryNote.count()).toBe(0);
    expect((await put("900101-1234567")).status).toBe(400);
  });
});
