/**
 * T2-4 API 공통 계층(defineRoute) — 세션·권한(기본 거부)·CSRF·입력 검증·감사 로그.
 * 시험용 라우트는 이 파일 안에서만 만든다(src/app에 두지 않는다).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { ApiError } from "@/server/api/errors";
import { callRoute, loginAs } from "./helpers/api";
import { createPatient, db, resetDb } from "./helpers";

beforeEach(resetDb);

// --- 시험용 라우트 ---

/** 환자 한 명 조회 — patient.read */
const getPatient = defineRoute({
  permission: "patient.read",
  audit: "TEST_PATIENT_VIEW",
  params: z.object({ id: z.uuid() }),
  handler: async (ctx) => {
    const patient = await db.patient.findUnique({ where: { id: ctx.params.id }, select: { id: true, name: true } });
    if (!patient) throw new ApiError(404, "NOT_FOUND", "고객을 찾을 수 없습니다.");
    ctx.touchPatients([patient.id]);
    return { patient, serverNow: ctx.now.toISOString() };
  },
});

/** 여러 명 목록 — patient.read, 검색어는 감사 행에 남기지 않는다 */
const searchPatients = defineRoute({
  permission: "patient.read",
  audit: "TEST_PATIENT_SEARCH",
  query: z.object({ q: z.string().min(1), limit: z.coerce.number().int().min(1).max(50).default(20) }),
  handler: async (ctx) => {
    const items = await db.patient.findMany({
      where: { name: { contains: ctx.query.q } },
      select: { id: true },
      take: ctx.query.limit,
    });
    ctx.touchPatients(items.map((p) => p.id));
    ctx.audit({ limit: ctx.query.limit });
    return { count: items.length };
  },
});

/** 쓰기 — patient.write (의사는 거부) */
const writePatient = defineRoute({
  permission: "patient.write",
  audit: "TEST_PATIENT_UPDATE",
  body: z.object({ memo: z.string().max(10), phone: z.string().regex(/^010-0\d{3}-\d{4}$/) }),
  handler: () => ({ ok: true }),
});

/** 처리하지 못한 에러 */
const crashing = defineRoute({
  permission: "authenticated",
  audit: "TEST_CRASH",
  handler: () => {
    throw new Error("내부 메시지 가상환자 010-0123-4567");
  },
});

/** 환자를 다루면서 audit "none"으로 잘못 선언한 라우트 */
const missingAudit = defineRoute({
  permission: "patient.read",
  audit: "none",
  handler: async (ctx) => {
    ctx.touchPatients(["01900000-0000-7000-8000-000000000001"]);
    return { leaked: true };
  },
});

const publicRoute = defineRoute({ permission: "public", audit: "none", handler: (ctx) => ({ staff: ctx.staff }) });

/** ctx.inputDevice를 그대로 돌려준다 */
const echoInputDevice = defineRoute({
  permission: "public",
  audit: "none",
  handler: (ctx) => ({ inputDevice: ctx.inputDevice }),
});

async function audits() {
  return db.auditLog.findMany({ orderBy: { createdAt: "asc" } });
}

describe("세션", () => {
  it("쿠키가 없으면 401 UNAUTHENTICATED, 감사 행 없음, 핸들러를 돌지 않는다", async () => {
    const patient = await createPatient();
    const res = await callRoute(getPatient, { params: { id: patient.id } });
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: { code: "UNAUTHENTICATED", message: "로그인이 필요합니다. 다시 로그인하세요." } });
    expect(await audits()).toHaveLength(0);
  });

  it("public 라우트는 세션 없이 돌고 staff는 null", async () => {
    const res = await callRoute(publicRoute);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ staff: null });
  });
});

describe("권한 (기본 거부)", () => {
  it("권한 없는 역할은 403 FORBIDDEN과 DENIED 감사 행", async () => {
    const doctor = await loginAs("DOCTOR");
    const res = await callRoute(writePatient, {
      method: "POST",
      url: "/api/test/patients/write?q=가상",
      cookie: doctor.cookie,
      body: { memo: "x", phone: "010-0123-4567" },
    });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe("FORBIDDEN");

    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ staffId: doctor.staff.id, action: "TEST_PATIENT_UPDATE", result: "DENIED", patientId: null });
    // 쿼리 문자열(검색어)은 남기지 않고 경로만 남긴다.
    expect(rows[0].detail).toEqual({ permission: "patient.write", method: "POST", path: "/api/test/patients/write" });
  });

  it("권한 있는 역할은 통과한다", async () => {
    const front = await loginAs("FRONT");
    const res = await callRoute(writePatient, {
      method: "POST",
      cookie: front.cookie,
      body: { memo: "x", phone: "010-0123-4567" },
    });
    expect(res.status).toBe(200);
  });
});

describe("CSRF", () => {
  it("다른 출처의 Origin은 403 CSRF (세션 확인 전)", async () => {
    const front = await loginAs("FRONT");
    const res = await callRoute(writePatient, {
      method: "POST",
      cookie: front.cookie,
      body: { memo: "x", phone: "010-0123-4567" },
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe("CSRF");
    expect(await audits()).toHaveLength(0);
  });

  it("Sec-Fetch-Site: cross-site도 거부한다", async () => {
    const front = await loginAs("FRONT");
    const res = await callRoute(writePatient, {
      method: "POST",
      cookie: front.cookie,
      body: { memo: "x", phone: "010-0123-4567" },
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe("CSRF");
  });

  it("같은 출처와 Origin 없는 요청은 통과, GET은 Origin을 보지 않는다", async () => {
    const front = await loginAs("FRONT");
    const patient = await createPatient();
    const sameOrigin = await callRoute(writePatient, {
      method: "POST",
      cookie: front.cookie,
      body: { memo: "x", phone: "010-0123-4567" },
      headers: { "sec-fetch-site": "same-origin" },
    });
    expect(sameOrigin.status).toBe(200);
    const get = await callRoute(getPatient, {
      cookie: front.cookie,
      params: { id: patient.id },
      headers: { origin: "https://evil.example" },
    });
    expect(get.status).toBe(200);
  });
});

describe("입력 검증", () => {
  it("400 VALIDATION_FAILED, 필드 경로와 오류 종류만 담고 입력값은 담지 않는다", async () => {
    const front = await loginAs("FRONT");
    const res = await callRoute(writePatient, {
      method: "POST",
      cookie: front.cookie,
      body: { memo: "가상환자메모가너무길다아", phone: "010-9999-1234" },
    });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("VALIDATION_FAILED");
    expect(res.json.error.fields).toEqual([
      { path: "memo", code: "too_big" },
      { path: "phone", code: "invalid_format" },
    ]);
    expect(res.text).not.toContain("가상환자메모");
    expect(res.text).not.toContain("9999");

    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ result: "FAILED", detail: { errorCode: "VALIDATION_FAILED", patientCount: 0 } });
  });

  it("깨진 JSON은 400 INVALID_JSON", async () => {
    const front = await loginAs("FRONT");
    const res = await callRoute(writePatient, { method: "POST", cookie: front.cookie, body: "{not json" });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("INVALID_JSON");
  });

  it("경로 파라미터도 검증한다", async () => {
    const front = await loginAs("FRONT");
    const res = await callRoute(getPatient, { cookie: front.cookie, params: { id: "not-a-uuid" } });
    expect(res.status).toBe(400);
    expect(res.json.error.fields).toEqual([{ path: "id", code: "invalid_format" }]);
  });
});

describe("감사 로그", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("프록시 설정이 없으면 클라이언트가 보낸 X-Forwarded-For를 IP로 남기지 않는다", async () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "");
    const front = await loginAs("FRONT");
    const patient = await createPatient();
    const res = await callRoute(getPatient, { cookie: front.cookie, params: { id: patient.id }, headers: { "x-forwarded-for": "1.2.3.4", "x-real-ip": "1.2.3.4" } });
    expect(res.status).toBe(200);
    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0].ip).toBeNull();
  });

  it("환자 한 명을 다루면 patient_id와 patientCount 1을 남긴다", async () => {
    const front = await loginAs("FRONT");
    const patient = await createPatient();
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    const res = await callRoute(getPatient, { cookie: front.cookie, params: { id: patient.id }, headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.7" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      staffId: front.staff.id,
      action: "TEST_PATIENT_VIEW",
      result: "SUCCESS",
      patientId: patient.id,
      ip: "10.0.0.7",
      userAgent: "vitest",
    });
    expect(rows[0].detail).toEqual({ patientCount: 1 });
  });

  it("여러 명이면 patient_id는 비우고 개수와 덧붙인 코드만 남긴다 (검색어 없음)", async () => {
    const counselor = await loginAs("COUNSELOR");
    await createPatient({ name: "가상검색일" });
    await createPatient({ name: "가상검색이" });
    await createPatient({ name: "다른사람" });

    const res = await callRoute(searchPatients, { url: "/api/test?q=가상검색", cookie: counselor.cookie });
    expect(res.json).toEqual({ count: 2 });

    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "TEST_PATIENT_SEARCH", result: "SUCCESS", patientId: null });
    expect(rows[0].detail).toEqual({ patientCount: 2, limit: 20 });
    expect(JSON.stringify(rows[0])).not.toContain("가상검색");
  });

  it("핸들러가 ApiError를 던지면 그 응답과 FAILED 감사 행", async () => {
    const front = await loginAs("FRONT");
    const id = "01900000-0000-7000-8000-000000000009";
    const res = await callRoute(getPatient, { cookie: front.cookie, params: { id } });
    expect(res.status).toBe(404);
    expect(res.json).toEqual({ error: { code: "NOT_FOUND", message: "고객을 찾을 수 없습니다." } });
    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ result: "FAILED", detail: { errorCode: "NOT_FOUND", patientCount: 0 } });
  });

  it("처리하지 못한 에러는 500 일반 문구, 메시지 원문은 응답·감사 행에 없다", async () => {
    const front = await loginAs("FRONT");
    const res = await callRoute(crashing, { cookie: front.cookie });
    expect(res.status).toBe(500);
    expect(res.json.error.code).toBe("INTERNAL");
    expect(res.text).not.toContain("가상환자");
    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0].result).toBe("FAILED");
    expect(JSON.stringify(rows[0])).not.toContain("가상환자");
  });

  it('audit "none"인데 환자를 다루면 응답하지 않고 500', async () => {
    const front = await loginAs("FRONT");
    const res = await callRoute(missingAudit, { cookie: front.cookie });
    expect(res.status).toBe(500);
    expect(res.text).not.toContain("leaked");
  });

  it("ctx.now는 서버 시각이다", async () => {
    const front = await loginAs("FRONT");
    const patient = await createPatient();
    const before = Date.now();
    const res = await callRoute(getPatient, { cookie: front.cookie, params: { id: patient.id } });
    const serverNow = Date.parse(res.json.serverNow);
    expect(serverNow).toBeGreaterThanOrEqual(before);
    expect(serverNow).toBeLessThanOrEqual(Date.now());
  });
});

describe("ctx.inputDevice (요청 헤더 x-input-device)", () => {
  const echo = async (value?: string) =>
    (await callRoute(echoInputDevice, value === undefined ? {} : { headers: { "x-input-device": value } })).json
      .inputDevice;

  it("영문·숫자·_.:-만으로 된 값은 앞뒤 공백을 자르고 64자까지 받는다", async () => {
    expect(await echo("web-0123456789ab")).toBe("web-0123456789ab");
    expect(await echo("front-pc_1:a.b")).toBe("front-pc_1:a.b");
    expect(await echo("a".repeat(80))).toBe("a".repeat(64));
  });

  it("없거나 형식이 틀리면 null", async () => {
    expect(await echo()).toBeNull();
    expect(await echo("")).toBeNull();
    expect(await echo("front pc")).toBeNull();
    // 한글은 UTF-8 바이트가 그대로 실려 온다
    expect(await echo(Buffer.from("접수PC", "utf8").toString("latin1"))).toBeNull();
  });
});

describe("쓰기 요청의 감사 행은 변경과 한 트랜잭션 (ctx.db)", () => {
  /** ctx.db로 메모를 바꾸고, fail이면 바꾼 뒤 ApiError를 던진다 */
  const writeMemo = defineRoute({
    permission: "patient.write",
    audit: "TEST_PATIENT_MEMO",
    params: z.object({ id: z.uuid() }),
    body: z.object({ memo: z.string().max(10), fail: z.boolean() }),
    handler: async (ctx) => {
      ctx.touchPatients([ctx.params.id]);
      await ctx.db.patient.update({ where: { id: ctx.params.id }, data: { memo: ctx.body.memo } });
      if (ctx.body.fail) throw new ApiError(409, "TEST_CONFLICT", "충돌");
      return { ok: true };
    },
  });

  const call = (cookie: string, id: string, body: Record<string, unknown>) =>
    callRoute(writeMemo, { method: "POST", cookie, params: { id }, body });

  it("성공하면 변경과 SUCCESS 행이 함께 남는다", async () => {
    const front = await loginAs("FRONT");
    const patient = await createPatient();
    expect((await call(front.cookie, patient.id, { memo: "새 메모", fail: false })).status).toBe(200);
    expect((await db.patient.findUniqueOrThrow({ where: { id: patient.id } })).memo).toBe("새 메모");
    const rows = await db.auditLog.findMany({ where: { action: "TEST_PATIENT_MEMO" } });
    expect(rows.map((r) => [r.result, r.patientId])).toEqual([["SUCCESS", patient.id]]);
  });

  it("핸들러가 쓰고 나서 던지면 변경은 취소되고 FAILED 행만 남는다", async () => {
    const front = await loginAs("FRONT");
    const patient = await createPatient();
    const res = await call(front.cookie, patient.id, { memo: "새 메모", fail: true });
    expect(res.status).toBe(409);
    expect((await db.patient.findUniqueOrThrow({ where: { id: patient.id } })).memo).toBeNull();
    const rows = await db.auditLog.findMany({ where: { action: "TEST_PATIENT_MEMO" } });
    expect(rows.map((r) => [r.result, r.patientId])).toEqual([["FAILED", patient.id]]);
    expect(rows[0].detail).toMatchObject({ errorCode: "TEST_CONFLICT" });
  });

  it("감사 행 INSERT가 실패하면 변경도 취소되고 500", async () => {
    const front = await loginAs("FRONT");
    const patient = await createPatient();
    // 이 라우트의 SUCCESS 감사 행 INSERT만 실패하도록 CHECK 제약을 잠시 건다.
    await db.$executeRawUnsafe(
      `ALTER TABLE audit_log ADD CONSTRAINT test_no_memo_success CHECK (NOT (action = 'TEST_PATIENT_MEMO' AND result = 'SUCCESS'))`,
    );
    try {
      const res = await call(front.cookie, patient.id, { memo: "새 메모", fail: false });
      expect(res.status).toBe(500);
      expect((await db.patient.findUniqueOrThrow({ where: { id: patient.id } })).memo).toBeNull();
      const rows = await db.auditLog.findMany({ where: { action: "TEST_PATIENT_MEMO" } });
      expect(rows.map((r) => r.result)).toEqual(["FAILED"]);
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE audit_log DROP CONSTRAINT test_no_memo_success`);
    }
  });
});

describe("요청 본문 상한", () => {
  it("상한(64 KiB)을 넘는 본문은 세션이 있어도 413, FAILED 감사 행", async () => {
    const front = await loginAs("FRONT");
    const patient = await createPatient();
    const res = await callRoute(writePatient, {
      method: "POST",
      cookie: front.cookie,
      params: { id: patient.id },
      body: JSON.stringify({ memo: "a".repeat(70 * 1024), phone: "010-0123-4567" }),
    });
    expect(res.status).toBe(413);
    expect(res.json.error.code).toBe("PAYLOAD_TOO_LARGE");
    const rows = await db.auditLog.findMany({ where: { action: "TEST_PATIENT_UPDATE" } });
    expect(rows.map((r) => r.result)).toEqual(["FAILED"]);
  });
});
