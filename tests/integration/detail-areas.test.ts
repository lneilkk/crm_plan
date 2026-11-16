/**
 * 확장 계획 S-5 — 예약 상세는 권한 단위 영역(기본 정보 / 상담·할인 / 수술 참여 직원 / 수술 메모)으로 나뉜다.
 * 화면이 그리지 않는 영역의 데이터는 예약 상세 API 응답에도 없다(항목 자체를 지운다).
 * 영역별 표는 src/lib/auth/screen-registry.test.ts와 docs/SCREEN_MAP.md 8장.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { GET as surgeryNoteGet } from "@/app/api/appointments/[id]/surgery-note/route";
import { GET as detailRoute } from "@/app/api/appointments/[id]/route";
import { DEFAULT_CLINIC_SETTINGS } from "@/lib/domain/clinic";
import { callRoute, loginAs } from "./helpers/api";
import { createAppointment, createStaff, db, resetDb } from "./helpers";

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

async function surgeryAppointment() {
  const nurse = await createStaff({ role: "NURSE" });
  const appointment = await createAppointment({ treatmentItem: "임플란트", listPrice: 1_000_000, discountRate: 10 });
  await db.appointmentParticipant.create({ data: { appointmentId: appointment.id, staffId: nurse.id } });
  return appointment;
}

const detail = (cookie: string, id: string) => callRoute(detailRoute, { url: `/api/appointments/${id}`, cookie, params: { id } });

describe("예약 상세 API — 영역별로 거른다", () => {
  it("첫 설치 값: 모든 직무가 참여 직원을 받고, 금액은 상담·관리자·원장만", async () => {
    const appointment = await surgeryAppointment();
    const expected = { FRONT: false, COUNSELOR: true, DOCTOR: true, NURSE: false, ADMIN: true } as const;
    for (const [role, price] of Object.entries(expected) as [keyof typeof expected, boolean][]) {
      const res = await detail((await loginAs(role)).cookie, appointment.id);
      expect(res.status, role).toBe(200);
      expect(res.json.appointment.participants, role).toHaveLength(1);
      expect("listPrice" in res.json.appointment, role).toBe(price);
      expect("discountRate" in res.json.appointment, role).toBe(price);
    }
  });

  it("직무에서 참여 직원 권한(surgery.record)을 빼면 응답에서 participants 항목이 사라진다(빈 목록이 아니라 항목 없음)", async () => {
    const appointment = await surgeryAppointment();
    await db.jobPermission.deleteMany({ where: { role: "FRONT", permission: "surgery.record" } });
    const res = await detail((await loginAs("FRONT")).cookie, appointment.id);
    expect(res.status).toBe(200);
    expect("participants" in res.json.appointment).toBe(false);
    expect(res.json.appointment.treatmentItem).toBe("임플란트"); // 기본 정보는 그대로
    // 다른 직무는 영향 없음
    expect((await detail((await loginAs("NURSE")).cookie, appointment.id)).json.appointment.participants).toHaveLength(1);
  });

  it("수술 메모는 따로 읽는 API이고, 메모 권한이 없으면 403", async () => {
    const appointment = await surgeryAppointment();
    for (const role of ["FRONT", "COUNSELOR", "NURSE"] as const) {
      const { cookie } = await loginAs(role);
      expect((await detail(cookie, appointment.id)).json.appointment, role).not.toHaveProperty("note");
      const res = await callRoute(surgeryNoteGet, { url: `/api/appointments/${appointment.id}/surgery-note`, cookie, params: { id: appointment.id } });
      expect(res.status, role).toBe(403);
    }
  });
});
