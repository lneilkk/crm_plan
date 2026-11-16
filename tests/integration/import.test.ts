/**
 * F-7 기존 CRM 엑셀 가져오기 — 관리자만, 시험 실행, 같은 파일 두 번 넣어도 중복 없음, 이력·동의 규칙, 보고서에 원문 없음.
 * 모든 값은 지어낸 값이다(절대 규칙 1).
 */
import { randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as importRoute } from "@/app/api/import/[kind]/route";
import { DEFAULT_CLINIC_SETTINGS } from "@/lib/domain/clinic";
import { callRoute, loginAs } from "./helpers/api";
import { createStaff, db, resetDb } from "./helpers";

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

function send(cookie: string, kind: string, rows: Record<string, string>[], dryRun = false, firstRow = 2) {
  return callRoute(importRoute, { method: "POST", url: `/api/import/${kind}`, cookie, params: { kind }, body: { dryRun, firstRow, rows } });
}

const PATIENTS: Record<string, string>[] = [
  { name: "가상일", phone: "010-0200-0001", birthDate: "1980.07.07", gender: "남", chartNo: "g001", referral: "지인 소개", tags: "VIP, 교정", memo: "치료 계획 상담 예정" },
  { name: "가상이", phone: "01002000002", chartNo: "G002" },
  { name: "가상삼", phone: "전화없음" },
  { name: "가상사", phone: "010-0200-0004", memo: "주민 800707-1234567" },
  { name: "가상일", phone: "010 0200 0001" }, // 파일 안 중복(같은 사람)
];

describe("권한", () => {
  it("관리자만 가져올 수 있다. 다른 역할은 403", async () => {
    for (const role of ["FRONT", "COUNSELOR", "DOCTOR"] as const) {
      const { cookie } = await loginAs(role);
      expect((await send(cookie, "patients", PATIENTS)).status).toBe(403);
    }
    expect(await db.patient.count()).toBe(0);
  });
});

describe("고객 가져오기", () => {
  it("시험 실행은 아무것도 쓰지 않고 보고서만 준다", async () => {
    const { cookie } = await loginAs("ADMIN");
    const res = await send(cookie, "patients", PATIENTS, true);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ dryRun: true, total: 5, created: 2, existing: 1 });
    expect(res.json.errors).toEqual([
      { row: 4, code: "PHONE_INVALID" },
      { row: 5, code: "RRN_IN_MEMO" },
    ]);
    expect(await db.patient.count()).toBe(0);
  });

  it("넣으면 번호는 암호화·구환·차트번호 대문자, 같은 파일을 다시 넣어도 중복이 없다. 응답·감사 행에 원문이 없다", async () => {
    const { cookie } = await loginAs("ADMIN");
    const first = await send(cookie, "patients", PATIENTS);
    expect(first.json).toMatchObject({ dryRun: false, created: 2, existing: 1 });
    const rows = await db.patient.findMany({ orderBy: { name: "asc" } });
    expect(rows).toHaveLength(2);
    const one = rows.find((p) => p.name === "가상일")!;
    expect(one).toMatchObject({ visitType: "RETURNING", dentwebChartNo: "G001", gender: "MALE", referralSource: "REFERRAL", tags: ["VIP", "교정"] });
    expect(one.phoneEnc.startsWith("v1.")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("0200-0001");

    const again = await send(cookie, "patients", PATIENTS);
    expect(again.json).toMatchObject({ created: 0, existing: 3 });
    expect(await db.patient.count()).toBe(2);

    for (const text of [first.text, JSON.stringify(await db.auditLog.findMany({ where: { action: "DATA_IMPORT" } }))]) {
      expect(text).not.toContain("가상일");
      expect(text).not.toContain("0200");
      expect(text).not.toContain("800707");
    }
  });

  it("다른 고객이 쓰는 차트번호는 오류, 501행 이상은 400", async () => {
    const { cookie } = await loginAs("ADMIN");
    await send(cookie, "patients", [{ name: "가상갑", phone: "010-0200-0011", chartNo: "G100" }]);
    const res = await send(cookie, "patients", [{ name: "가상을", phone: "010-0200-0012", chartNo: "g100" }]);
    expect(res.json.errors).toEqual([{ row: 2, code: "CHART_NO_TAKEN" }]);
    const many = Array.from({ length: 501 }, (_, i) => ({ name: `가상${i}`, phone: `010-0300-${String(i).padStart(4, "0")}` }));
    expect((await send(cookie, "patients", many)).status).toBe(400);
  });
});

describe("예약·내원 이력 가져오기", () => {
  it("차트번호·이름+번호로 고객을 찾고, 상태와 상태 이력을 함께 쓰며, 겹치는 시간은 이관 체어로 나눈다. 다시 넣어도 중복 없음", async () => {
    const { cookie } = await loginAs("ADMIN");
    await send(cookie, "patients", PATIENTS);
    const doctor = await createStaff({ role: "DOCTOR", name: "가상원장" });
    const rows: Record<string, string>[] = [
      { chartNo: "G001", date: "2025-03-02", time: "10:00", item: "임플란트", status: "진료완료", doctor: "가상원장", chair: "체어 1" },
      { name: "가상이", phone: "010-0200-0002", date: "2025-03-02 10:00", item: "스케일링", status: "내원", chair: "체어 1" },
      { name: "가상이", phone: "010-0200-0002", date: "2025-03-09", time: "오후 2:30", status: "노쇼" },
      { name: "없는사람", phone: "010-0200-0099", date: "2025-03-02" },
      { chartNo: "G001", date: "2025-02-30" },
      { chartNo: "G001", date: "2025-03-10", status: "알수없음" },
    ];
    const res = await send(cookie, "appointments", rows);
    expect(res.json).toMatchObject({ created: 3, existing: 0 });
    expect(res.json.errors).toEqual([
      { row: 5, code: "PATIENT_NOT_FOUND" },
      { row: 6, code: "DATE_INVALID" },
      { row: 7, code: "STATUS_UNKNOWN" },
    ]);
    expect(res.json.notes).toMatchObject({ CHAIR_IMPORT: 2 });

    const appts = await db.appointment.findMany({ orderBy: [{ startAt: "asc" }, { chair: "asc" }], include: { statusLogs: true } });
    expect(appts.map((a) => [a.chair, a.status, a.treatmentItem])).toEqual([
      ["C1", "LEFT", "임플란트"],
      ["이관1", "ARRIVED", "스케일링"],
      ["이관1", "NO_SHOW", "기타"],
    ]);
    expect(appts[0]).toMatchObject({ doctorId: doctor.id, listPrice: 1_200_000, arrivedAt: appts[0].startAt });
    for (const a of appts) {
      const latest = [...a.statusLogs].sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime()).at(-1)!;
      expect(latest.toStatus).toBe(a.status);
      expect(latest.inputDevice).toBe("import");
    }
    expect((await db.patient.findFirstOrThrow({ where: { name: "가상이" } })).noShowCount).toBe(1);

    const again = await send(cookie, "appointments", rows);
    expect(again.json).toMatchObject({ created: 0, existing: 3 });
    expect(await db.appointment.count()).toBe(3);
  });
});

describe("상담 기록 가져오기", () => {
  it("민감정보 동의가 Y인 행만 넣고 동의 기록을 남긴다. 상담자를 못 찾으면 가져오는 관리자. 다시 넣어도 중복 없음", async () => {
    const admin = await loginAs("ADMIN");
    await send(admin.cookie, "patients", PATIENTS);
    const counselor = await createStaff({ role: "COUNSELOR", name: "가상실장" });
    const rows: Record<string, string>[] = [
      { chartNo: "G001", date: "2025-03-01", counselor: "가상실장", content: "임플란트 상담", items: "임플란트, 보철", result: "예약 전환", consent: "Y" },
      { chartNo: "G002", date: "2025-03-01", counselor: "모르는사람", content: "교정 문의", consent: "동의" },
      { chartNo: "G002", date: "2025-03-05", content: "미백 문의", consent: "N" },
      { chartNo: "G001", date: "2025-03-06", content: "주민 800707-1234567 확인", consent: "Y" },
    ];
    const res = await send(admin.cookie, "consultations", rows);
    expect(res.json).toMatchObject({ created: 2, skipped: { CONSENT_MISSING: 1 }, notes: { COUNSELOR_FALLBACK: 1, CONSENT_RECORDED: 2 } });
    expect(res.json.errors).toEqual([{ row: 5, code: "RRN_IN_CONTENT" }]);
    const list = await db.consultation.findMany({ orderBy: { createdAt: "asc" } });
    expect(list.map((c) => [c.counselorId, c.result, c.interestedItems])).toEqual([
      [counselor.id, "BOOKED", ["임플란트", "보철"]],
      [admin.staff.id, "PENDING", []],
    ]);
    expect(await db.consent.count({ where: { type: "SENSITIVE", agreed: true } })).toBe(2);

    const again = await send(admin.cookie, "consultations", rows);
    expect(again.json).toMatchObject({ created: 0, existing: 2 });
    expect(await db.consultation.count()).toBe(2);
    expect(await db.consent.count()).toBe(2);
  });
});
