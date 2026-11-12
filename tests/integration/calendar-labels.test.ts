/**
 * F-2 예약 색 라벨과 상태 표시 — 관리자만 편집, 예약에 라벨 붙이기, 목록·상세에 labelIds, 감사 로그.
 */
import { randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as listRoute, POST as createRoute } from "@/app/api/appointments/route";
import { GET as detailRoute } from "@/app/api/appointments/[id]/route";
import { PUT as labelsRoute } from "@/app/api/appointments/[id]/labels/route";
import { GET as styleGet, PUT as stylePut } from "@/app/api/settings/calendar-style/route";
import { DEFAULT_STATUS_STYLES } from "@/lib/calendar/colors";
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
    },
  });
});

const DAY = addDays(kstDateKey(new Date()), 7);

function save(cookie: string, body: unknown) {
  return callRoute(stylePut, { method: "PUT", url: "/api/settings/calendar-style", cookie, body });
}

function setLabels(cookie: string, id: string, labelIds: string[]) {
  return callRoute(labelsRoute, { method: "PUT", url: `/api/appointments/${id}/labels`, cookie, params: { id }, body: { labelIds } });
}

const baseStyle = (labels: unknown[]) => ({ labels, statusStyles: DEFAULT_STATUS_STYLES });

async function threeLabels(cookie: string) {
  const res = await save(
    cookie,
    baseStyle([
      { name: "200", color: "#F2E21B", isActive: true },
      { name: "초진", color: "#1E73E8", isActive: true },
      { name: "vip", color: "#8FB0CC", isActive: true },
    ]),
  );
  expect(res.status).toBe(200);
  return res.json.labels as { id: string; name: string; sortOrder: number; isActive: boolean; color: string }[];
}

describe("캘린더 색 설정 (GET·PUT /api/settings/calendar-style)", () => {
  it("모든 역할이 읽을 수 있고, 저장된 값이 없으면 상태 표시는 기본값", async () => {
    for (const role of ["FRONT", "COUNSELOR", "DOCTOR", "ADMIN"] as const) {
      const { cookie } = await loginAs(role);
      const res = await callRoute(styleGet, { url: "/api/settings/calendar-style", cookie });
      expect(res.status).toBe(200);
      expect(res.json.statusStyles).toEqual(DEFAULT_STATUS_STYLES);
    }
  });

  it("관리자만 저장할 수 있다. 다른 역할은 403과 DENIED 감사 행", async () => {
    for (const role of ["FRONT", "COUNSELOR", "DOCTOR"] as const) {
      const { cookie } = await loginAs(role);
      expect((await save(cookie, baseStyle([]))).status).toBe(403);
    }
    expect(await db.auditLog.count({ where: { action: "CALENDAR_STYLE_UPDATE", result: "DENIED" } })).toBe(3);
    expect(await db.appointmentLabel.count()).toBe(0);
  });

  it("저장하면 화면 순서대로 sortOrder가 매겨지고, 상태 이름·색도 바뀐다. 감사 행 SUCCESS", async () => {
    const { cookie } = await loginAs("ADMIN");
    const labels = await threeLabels(cookie);
    expect(labels.map((l) => [l.name, l.sortOrder])).toEqual([["200", 0], ["초진", 1], ["vip", 2]]);

    const statusStyles = { ...DEFAULT_STATUS_STYLES, BOOKED: { name: "확정", color: "#123456" } };
    const res = await save(cookie, {
      labels: [labels[2], labels[0], { ...labels[1], color: "#00ff00", isActive: false }].map(({ id, name, color, isActive }) => ({ id, name, color, isActive })),
      statusStyles,
    });
    expect(res.status).toBe(200);
    expect(res.json.labels.map((l: { name: string }) => l.name)).toEqual(["vip", "200", "초진"]);
    expect(res.json.labels[2]).toMatchObject({ color: "#00FF00", isActive: false });
    expect(res.json.statusStyles.BOOKED).toEqual({ name: "확정", color: "#123456" });
    expect(await db.auditLog.count({ where: { action: "CALENDAR_STYLE_UPDATE", result: "SUCCESS" } })).toBe(2);
  });

  it("이름을 맞바꿔도 저장된다(고유 이름 제약)", async () => {
    const { cookie } = await loginAs("ADMIN");
    const [a, b] = await threeLabels(cookie);
    const res = await save(cookie, baseStyle([
      { id: a.id, name: b.name, color: a.color, isActive: true },
      { id: b.id, name: a.name, color: b.color, isActive: true },
    ]));
    expect(res.status).toBe(200);
    expect(res.json.labels.map((l: { id: string; name: string }) => [l.id, l.name])).toEqual([[a.id, "초진"], [b.id, "200"]]);
  });

  it("틀린 입력은 400: 색 형식(스타일 주입 포함), 같은 이름, 너무 긴 이름, 상태 빠짐", async () => {
    const { cookie } = await loginAs("ADMIN");
    for (const body of [
      baseStyle([{ name: "x", color: "red", isActive: true }]),
      baseStyle([{ name: "x", color: "#123456;background:url(a)", isActive: true }]),
      baseStyle([{ name: "x", color: "#123456", isActive: true }, { name: " X ", color: "#123456", isActive: true }]),
      baseStyle([{ name: "가".repeat(21), color: "#123456", isActive: true }]),
      { labels: [], statusStyles: { BOOKED: DEFAULT_STATUS_STYLES.BOOKED } },
    ]) {
      expect((await save(cookie, body)).status).toBe(400);
    }
    expect(await db.appointmentLabel.count()).toBe(0);
  });

  it("목록에서 뺀 라벨: 예약에 붙지 않았으면 지워지고, 붙어 있으면 409 LABEL_IN_USE로 아무것도 바뀌지 않는다", async () => {
    const admin = await loginAs("ADMIN");
    const [a, b, c] = await threeLabels(admin.cookie);
    const appointment = await createAppointment();
    expect((await setLabels(admin.cookie, appointment.id, [a.id])).status).toBe(200);

    const conflict = await save(admin.cookie, baseStyle([b, c].map(({ id, name, color, isActive }) => ({ id, name, color, isActive }))));
    expect(conflict.status).toBe(409);
    expect(conflict.json.error.code).toBe("LABEL_IN_USE");
    expect(await db.appointmentLabel.count()).toBe(3);

    const ok = await save(admin.cookie, baseStyle([a, b].map(({ id, name, color, isActive }) => ({ id, name, color, isActive }))));
    expect(ok.status).toBe(200);
    expect(await db.appointmentLabel.count()).toBe(2);
  });
});

describe("예약에 라벨 붙이기 (PUT /api/appointments/[id]/labels)", () => {
  it("프론트·상담·관리자는 붙일 수 있고 의사는 403. 감사 행에 환자 id가 남는다", async () => {
    const admin = await loginAs("ADMIN");
    const [a, b] = await threeLabels(admin.cookie);
    const appointment = await createAppointment();

    for (const role of ["FRONT", "COUNSELOR"] as const) {
      const { cookie } = await loginAs(role);
      const res = await setLabels(cookie, appointment.id, [a.id, b.id, a.id]);
      expect(res.status).toBe(200);
      expect(res.json.labelIds).toEqual([a.id, b.id]);
    }
    const doctor = await loginAs("DOCTOR");
    expect((await setLabels(doctor.cookie, appointment.id, [])).status).toBe(403);

    const audits = await db.auditLog.findMany({ where: { action: "APPOINTMENT_LABELS_UPDATE", result: "SUCCESS" } });
    expect(audits).toHaveLength(2);
    expect(audits[0].patientId).toBe(appointment.patientId);
    expect(await db.appointmentLabelLink.count({ where: { appointmentId: appointment.id } })).toBe(2);
  });

  it("빼면 연결이 지워지고, 숨긴 라벨은 새로 붙일 수 없지만 이미 붙어 있던 것은 둘 수 있다", async () => {
    const admin = await loginAs("ADMIN");
    const [a, b, c] = await threeLabels(admin.cookie);
    const appointment = await createAppointment();
    await setLabels(admin.cookie, appointment.id, [a.id, b.id]);
    await save(admin.cookie, baseStyle([a, b, c].map(({ id, name, color }) => ({ id, name, color, isActive: id === c.id }))));

    expect((await setLabels(admin.cookie, appointment.id, [a.id])).status).toBe(200); // b 빼기, 숨긴 a 유지
    const hidden = await setLabels(admin.cookie, appointment.id, [a.id, b.id]); // 숨긴 b 다시 붙이기
    expect(hidden.status).toBe(400);
    expect(hidden.json.error.code).toBe("UNKNOWN_LABEL");
    expect((await setLabels(admin.cookie, appointment.id, [a.id, c.id])).status).toBe(200);
    const links = await db.appointmentLabelLink.findMany({ where: { appointmentId: appointment.id } });
    expect(links.map((l) => l.labelId).sort()).toEqual([a.id, c.id].sort());
  });

  it("없는 예약 404, 없는 라벨 400, 11개 이상 400", async () => {
    const admin = await loginAs("ADMIN");
    const [a] = await threeLabels(admin.cookie);
    expect((await setLabels(admin.cookie, "01900000-0000-7000-8000-000000000000", [a.id])).status).toBe(404);
    const appointment = await createAppointment();
    expect((await setLabels(admin.cookie, appointment.id, ["01900000-0000-7000-8000-000000000001"])).status).toBe(400);
    const many = Array.from({ length: 11 }, (_, i) => `01900000-0000-7000-8000-0000000000${String(i).padStart(2, "0")}`);
    expect((await setLabels(admin.cookie, appointment.id, many)).status).toBe(400);
  });
});

describe("예약 목록·상세·등록과 라벨", () => {
  it("등록할 때 라벨을 함께 붙이고, 목록과 상세에 labelIds가 나온다", async () => {
    const admin = await loginAs("ADMIN");
    const [a, b] = await threeLabels(admin.cookie);
    const front = await loginAs("FRONT");
    const patient = await createPatient();
    const created = await callRoute(createRoute, {
      method: "POST",
      url: "/api/appointments",
      cookie: front.cookie,
      body: {
        patientId: patient.id,
        startAt: kstDateTime(DAY, "10:00").toISOString(),
        durationMin: 30,
        chair: DEFAULT_CLINIC_SETTINGS.chairs[0].code,
        treatmentItem: DEFAULT_CLINIC_SETTINGS.treatmentItems[0],
        channel: "PHONE",
        labelIds: [b.id, a.id],
      },
    });
    expect(created.status).toBe(201);
    const id = created.json.appointment.id as string;

    const list = await callRoute(listRoute, { url: `/api/appointments?from=${DAY}&to=${DAY}`, cookie: front.cookie });
    expect(list.json.items[0].labelIds.sort()).toEqual([a.id, b.id].sort());
    const detail = await callRoute(detailRoute, { url: `/api/appointments/${id}`, cookie: front.cookie, params: { id } });
    expect(detail.json.appointment.labelIds.sort()).toEqual([a.id, b.id].sort());
  });

  it("등록 때 숨긴·없는 라벨이 있으면 예약도 만들어지지 않는다(한 트랜잭션)", async () => {
    const front = await loginAs("FRONT");
    const patient = await createPatient();
    const res = await callRoute(createRoute, {
      method: "POST",
      url: "/api/appointments",
      cookie: front.cookie,
      body: {
        patientId: patient.id,
        startAt: kstDateTime(DAY, "11:00").toISOString(),
        durationMin: 30,
        chair: DEFAULT_CLINIC_SETTINGS.chairs[0].code,
        treatmentItem: DEFAULT_CLINIC_SETTINGS.treatmentItems[0],
        channel: "PHONE",
        labelIds: ["01900000-0000-7000-8000-000000000009"],
      },
    });
    expect(res.status).toBe(400);
    expect(await db.appointment.count()).toBe(0);
    expect(await db.visitStatusLog.count()).toBe(0);
  });
});
