/**
 * T5-5 — 워크인 등록: 예약 없이 온 고객을 검색 또는 신규 등록 후 바로 내원 처리.
 * 완료 기준: 예약 채널 '워크인'으로 통계에 구분 집계.
 */
import { randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as walkInRoute } from "@/app/api/board/walk-in/route";
import { POST as createRoute } from "@/app/api/appointments/route";
import { GET as boardRoute } from "@/app/api/board/route";
import { POST as patientCreateRoute } from "@/app/api/patients/route";
import { GET as statsRoute } from "@/app/api/stats/route";
import { DEFAULT_CLINIC_SETTINGS } from "@/lib/domain/clinic";
import { kstDateKey } from "@/lib/time/kst";
import { callRoute, loginAs } from "./helpers/api";
import { db, resetDb } from "./helpers";

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

const CHAIR = DEFAULT_CLINIC_SETTINGS.chairs.find((c) => c.kind === "CHAIR")!.code;
const TODAY = kstDateKey(new Date());
let seq = 0;
async function newPatient(cookie: string) {
  seq += 1;
  const res = await callRoute(patientCreateRoute, { method: "POST", url: "/api/patients", cookie, body: { name: `가상워크인${seq}`, phone: `010-0888-${String(1000 + seq)}` } });
  expect(res.status).toBe(201);
  return res.json.id as string;
}
const walkIn = (cookie: string, body: Record<string, unknown>) => callRoute(walkInRoute, { method: "POST", url: "/api/board/walk-in", cookie, body });

describe("POST /api/board/walk-in", () => {
  it("지금 시각(5분 단위) 워크인 예약을 만들고 바로 내원 — 상태 이력 두 행, 감사 행에 고객", async () => {
    const front = await loginAs("FRONT");
    const patientId = await newPatient(front.cookie);
    const before = Date.now();
    const res = await walkIn(front.cookie, { patientId, chair: CHAIR, treatmentItem: "정기검진", durationMin: 30 });
    expect(res.status).toBe(201);
    const appointment = await db.appointment.findUniqueOrThrow({ where: { id: res.json.appointment.id } });
    expect(appointment).toMatchObject({ channel: "WALK_IN", status: "ARRIVED", patientId, chair: CHAIR, createdById: front.staff.id });
    expect(appointment.startAt.getTime() % (5 * 60_000)).toBe(0);
    expect(appointment.startAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(appointment.startAt.getTime()).toBeGreaterThan(before - 5 * 60_000);
    expect(appointment.arrivedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(res.json.isLate).toBe(false);
    const logs = await db.visitStatusLog.findMany({ where: { appointmentId: appointment.id }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => [l.fromStatus, l.toStatus, l.staffId])).toEqual([
      [null, "BOOKED", front.staff.id],
      ["BOOKED", "ARRIVED", front.staff.id],
    ]);
    expect(await db.auditLog.findFirst({ where: { action: "WALK_IN_REGISTER", result: "SUCCESS" } })).toMatchObject({ patientId, staffId: front.staff.id });
    // 오늘 내원 보드에 내원으로 보인다
    const board = await callRoute(boardRoute, { url: "/api/board", cookie: front.cookie });
    expect(board.json.items.find((row: { id: string }) => row.id === appointment.id)).toMatchObject({ status: "ARRIVED", channel: "WALK_IN" });
  });

  it("통계에서 워크인 채널로 따로 센다(완료 기준)", async () => {
    const front = await loginAs("FRONT");
    await walkIn(front.cookie, { patientId: await newPatient(front.cookie), chair: CHAIR, treatmentItem: "정기검진", durationMin: 30 });
    const admin = await loginAs("ADMIN");
    const stats = await callRoute(statsRoute, { url: `/api/stats?from=${TODAY}&to=${TODAY}&unit=day`, cookie: admin.cookie });
    expect(stats.status).toBe(200);
    const byChannel = stats.json.byChannel as { channel: string; stats: { booked: number; arrived: number; arrivalRate: number } }[];
    expect(byChannel.find((c) => c.channel === "WALK_IN")!.stats).toMatchObject({ booked: 1, arrived: 1, arrivalRate: 1 });
    for (const other of byChannel.filter((c) => c.channel !== "WALK_IN")) expect(other.stats.booked, other.channel).toBe(0);
  });

  it("예약 쓰기와 내원 상태 변경 권한이 모두 있어야 한다: 간호(내원만)·원장(둘 다 없음) 403", async () => {
    const front = await loginAs("FRONT");
    const patientId = await newPatient(front.cookie);
    for (const role of ["NURSE", "DOCTOR"] as const) {
      const res = await walkIn((await loginAs(role)).cookie, { patientId, chair: CHAIR, treatmentItem: "정기검진", durationMin: 30 });
      expect(res.status, role).toBe(403);
    }
    // 예약 쓰기만 있고 내원 상태 변경이 없는 직무
    await db.jobPermission.deleteMany({ where: { role: "COUNSELOR", permission: "visit.write" } });
    expect((await walkIn((await loginAs("COUNSELOR")).cookie, { patientId, chair: CHAIR, treatmentItem: "정기검진", durationMin: 30 })).status).toBe(403);
    expect(await db.appointment.count()).toBe(0);
  });

  it("체어가 겹치면 409이고 예약·상태 이력이 남지 않는다. 일반 예약 등록으로는 워크인을 만들 수 없다", async () => {
    const front = await loginAs("FRONT");
    const first = await newPatient(front.cookie);
    expect((await walkIn(front.cookie, { patientId: first, chair: CHAIR, treatmentItem: "정기검진", durationMin: 30 })).status).toBe(201);
    const second = await newPatient(front.cookie);
    const conflict = await walkIn(front.cookie, { patientId: second, chair: CHAIR, treatmentItem: "정기검진", durationMin: 30 });
    expect(conflict.status).toBe(409);
    expect(conflict.json.error.code).toBe("CHAIR_CONFLICT");
    expect(await db.appointment.count({ where: { patientId: second } })).toBe(0);
    expect(await db.visitStatusLog.count()).toBe(2);
    const viaCreate = await callRoute(createRoute, {
      method: "POST",
      url: "/api/appointments",
      cookie: front.cookie,
      body: { patientId: second, startAt: new Date(Date.UTC(2030, 0, 2, 1, 0)).toISOString(), durationMin: 30, chair: CHAIR, treatmentItem: "정기검진", channel: "WALK_IN" },
    });
    expect(viaCreate.status).toBe(400);
  });

  it("시각·상태·채널은 받지 않는다(서버가 정함), 없는 고객 404", async () => {
    const front = await loginAs("FRONT");
    const patientId = await newPatient(front.cookie);
    expect((await walkIn(front.cookie, { patientId, chair: CHAIR, treatmentItem: "정기검진", durationMin: 30, startAt: new Date().toISOString() })).status).toBe(400);
    expect((await walkIn(front.cookie, { patientId, chair: CHAIR, treatmentItem: "정기검진", durationMin: 30, channel: "PHONE" })).status).toBe(400);
    expect((await walkIn(front.cookie, { patientId: "01a1e2e8-0000-7000-8000-000000000000", chair: CHAIR, treatmentItem: "정기검진", durationMin: 30 })).status).toBe(404);
  });
});
