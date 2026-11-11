/**
 * T3-1 고객 등록·수정(같은 번호 경고), T3-2 고객 검색(500명에서 0.5초 이내) — /api/patients 라우트.
 * 모든 데이터는 가짜다(번호는 010-0XXX-XXXX 대역, 이름은 지어낸 것).
 */
import { randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getOne, PATCH } from "@/app/api/patients/[id]/route";
import { GET as search, POST } from "@/app/api/patients/route";
import { formatPhone } from "@/lib/phone";
import { sealPhone } from "@/server/crypto/pii";
import { generateFakeData } from "../../scripts/fake-data/generate";
import { FAKE_DOCTOR_KEYS, FAKE_FRONT_KEYS, insertFakeData } from "../../scripts/fake-data/run";
import { callRoute, loginAs } from "./helpers/api";
import { createAppointment, createPatient, createStaff, db, resetDb } from "./helpers";

beforeAll(() => {
  // 키는 실행마다 새로 만든다. 저장소에는 키 문자열을 두지 않는다.
  process.env.PII_ENC_KEY = randomBytes(32).toString("base64");
  process.env.PII_HMAC_KEY = randomBytes(32).toString("base64");
});

beforeEach(resetDb);

const PHONE = "010-0123-4567";
const PHONE_DIGITS = "01001234567";

function auditRows(action: string) {
  return db.auditLog.findMany({ where: { action }, orderBy: { createdAt: "asc" } });
}

async function register(cookie: string, body: Record<string, unknown>) {
  return callRoute(POST, { method: "POST", url: "/api/patients", cookie, body });
}

describe("T3-1 고객 등록", () => {
  it("등록하면 201과 id를 주고, 상세에서 모든 항목을 돌려준다", async () => {
    const { cookie, staff } = await loginAs("FRONT");
    const res = await register(cookie, {
      name: "가상하늘",
      phone: PHONE,
      birthDate: "1990-05-17",
      gender: "FEMALE",
      referralSource: "WEBSITE",
      tags: ["VIP", "VIP", "임플란트상담"],
      dentwebChartNo: "F900001",
      memo: "오전 선호",
    });
    expect(res.status).toBe(201);
    const id = res.json.id as string;

    const stored = await db.patient.findUniqueOrThrow({ where: { id } });
    expect(stored.createdById).toBe(staff.id);
    expect(stored.tags).toEqual(["VIP", "임플란트상담"]);

    const detail = await callRoute(getOne, { url: `/api/patients/${id}`, cookie, params: { id } });
    expect(detail.status).toBe(200);
    expect(detail.json.patient).toMatchObject({
      id,
      name: "가상하늘",
      phone: PHONE,
      birthDate: "1990-05-17",
      gender: "FEMALE",
      visitType: "NEW",
      referralSource: "WEBSITE",
      dentwebChartNo: "F900001",
      memo: "오전 선호",
      noShowCount: 0,
    });
    expect(detail.json.appointments).toEqual([]);
  });

  it("DB에는 번호·생년월일 평문이 없다", async () => {
    const { cookie } = await loginAs("FRONT");
    const res = await register(cookie, { name: "가상바다", phone: PHONE, birthDate: "1985-01-02" });
    const stored = await db.patient.findUniqueOrThrow({ where: { id: res.json.id } });
    const raw = JSON.stringify(stored);
    for (const plain of [PHONE, PHONE_DIGITS, "01234567", "1985-01-02"]) expect(raw).not.toContain(plain);
    expect(stored.phoneEnc.startsWith("v1.")).toBe(true);
    expect(stored.birthDateEnc?.startsWith("v1.")).toBe(true);
  });

  it("같은 번호면 409 DUPLICATE_PHONE과 마스킹한 기존 고객을 돌려주고, confirmDuplicate면 등록한다", async () => {
    const { cookie } = await loginAs("FRONT");
    const first = await register(cookie, { name: "가상가족", phone: PHONE, birthDate: "1960-03-04" });
    expect(first.status).toBe(201);

    // 다른 표기의 같은 번호
    const dup = await register(cookie, { name: "가상자녀", phone: "+82 10-0123-4567" });
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe("DUPLICATE_PHONE");
    expect(dup.json.error.message).toContain("같은 번호로 등록된 고객이 있습니다");
    expect(dup.json.duplicates).toEqual([{ id: first.json.id, nameMasked: "가**족", birthYear: 1960 }]);
    expect(dup.text).not.toContain("가상가족");
    expect(dup.text).not.toContain("가상자녀");
    expect(dup.text).not.toContain("0123-4567");
    expect(dup.text).not.toContain(PHONE_DIGITS);
    expect(await db.patient.count()).toBe(1);

    const confirmed = await register(cookie, { name: "가상자녀", phone: "01001234567", confirmDuplicate: true });
    expect(confirmed.status).toBe(201);
    expect(await db.patient.count()).toBe(2);

    const rows = await auditRows("PATIENT_CREATE");
    expect(rows.map((r) => r.result)).toEqual(["SUCCESS", "FAILED", "SUCCESS"]);
    expect(rows[1].detail).toMatchObject({ errorCode: "DUPLICATE_PHONE", patientCount: 1 });
  });

  it("같은 차트번호는 409 DUPLICATE_CHART_NO로 막는다 (확인해도 막힌다)", async () => {
    const { cookie } = await loginAs("FRONT");
    expect((await register(cookie, { name: "가상일", phone: "010-0111-1111", dentwebChartNo: "F900002" })).status).toBe(201);
    const res = await register(cookie, {
      name: "가상이",
      phone: "010-0222-2222",
      dentwebChartNo: "F900002",
      confirmDuplicate: true,
    });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("DUPLICATE_CHART_NO");
    expect(await db.patient.count()).toBe(1);
  });

  it("입력 오류는 400과 필드 경로만 돌려준다 (값은 돌려주지 않는다)", async () => {
    const { cookie } = await loginAs("FRONT");
    const res = await register(cookie, { name: "", phone: "010-0123-456가", birthDate: "1990-02-30" });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("VALIDATION_FAILED");
    const paths = (res.json.error.fields as { path: string }[]).map((f) => f.path).sort();
    expect(paths).toEqual(["birthDate", "name", "phone"]);
    expect(res.text).not.toContain("456가");
  });

  it("의사는 등록할 수 없다 (403, DENIED 감사 행)", async () => {
    const { cookie, staff } = await loginAs("DOCTOR");
    const res = await register(cookie, { name: "가상의사환자", phone: PHONE });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe("FORBIDDEN");
    expect(await db.patient.count()).toBe(0);
    const [row] = await auditRows("PATIENT_CREATE");
    expect(row).toMatchObject({ staffId: staff.id, result: "DENIED" });
  });

  it("의사는 검색·상세 조회는 할 수 있다", async () => {
    const { cookie } = await loginAs("DOCTOR");
    const patient = await createPatient({ ...sealPhone(PHONE), name: "가상조회" });
    expect((await callRoute(search, { url: "/api/patients?q=4567", cookie })).status).toBe(200);
    const detail = await callRoute(getOne, { url: `/api/patients/${patient.id}`, cookie, params: { id: patient.id } });
    expect(detail.status).toBe(200);
  });

  it("세션이 없으면 401", async () => {
    const res = await callRoute(search, { url: "/api/patients?q=4567" });
    expect(res.status).toBe(401);
  });
});

describe("T3-1 고객 수정", () => {
  it("보낸 필드만 바꾸고, 빈 값은 지운다", async () => {
    const { cookie } = await loginAs("COUNSELOR");
    const created = await register(cookie, {
      name: "가상수정",
      phone: PHONE,
      birthDate: "1991-01-01",
      memo: "처음 메모",
      dentwebChartNo: "F900003",
      tags: ["A"],
    });
    const id = created.json.id as string;

    const res = await callRoute(PATCH, {
      method: "PATCH",
      url: `/api/patients/${id}`,
      cookie,
      params: { id },
      body: { memo: "", tags: ["B"], visitType: "RETURNING" },
    });
    expect(res.status).toBe(200);
    const stored = await db.patient.findUniqueOrThrow({ where: { id } });
    expect(stored).toMatchObject({ name: "가상수정", memo: null, tags: ["B"], visitType: "RETURNING", dentwebChartNo: "F900003" });
    expect(stored.birthDateEnc).not.toBeNull();

    const [row] = await auditRows("PATIENT_UPDATE");
    expect(row).toMatchObject({ result: "SUCCESS", patientId: id });
    expect(row.detail).toMatchObject({ patientCount: 1 });
  });

  it("다른 고객의 번호로 바꾸면 같은 경고(409), 확인하면 바꾼다. 같은 번호 그대로면 경고하지 않는다", async () => {
    const { cookie } = await loginAs("FRONT");
    const a = await register(cookie, { name: "가상에이", phone: "010-0333-3333" });
    const b = await register(cookie, { name: "가상비이", phone: "010-0444-4444" });
    const id = b.json.id as string;
    const patch = (body: Record<string, unknown>) =>
      callRoute(PATCH, { method: "PATCH", url: `/api/patients/${id}`, cookie, params: { id }, body });

    expect((await patch({ phone: "010 0444 4444", name: "가상비이2" })).status).toBe(200);

    const dup = await patch({ phone: "010-0333-3333" });
    expect(dup.status).toBe(409);
    expect(dup.json.duplicates).toEqual([{ id: a.json.id, nameMasked: "가**이", birthYear: null }]);
    const before = await db.patient.findUniqueOrThrow({ where: { id } });
    expect(before.phoneHash).toBe(sealPhone("01004444444").phoneHash);

    expect((await patch({ phone: "010-0333-3333", confirmDuplicate: true })).status).toBe(200);
    const after = await db.patient.findUniqueOrThrow({ where: { id } });
    expect(after.phoneHash).toBe(sealPhone("01003333333").phoneHash);
  });

  it("다른 고객의 차트번호로 바꾸면 409, 없는 고객은 404, 의사는 403", async () => {
    const { cookie } = await loginAs("FRONT");
    await register(cookie, { name: "가상차트", phone: "010-0555-5555", dentwebChartNo: "F900004" });
    const other = await register(cookie, { name: "가상차트이", phone: "010-0666-6666" });
    const id = other.json.id as string;

    const clash = await callRoute(PATCH, {
      method: "PATCH",
      url: `/api/patients/${id}`,
      cookie,
      params: { id },
      body: { dentwebChartNo: "F900004" },
    });
    expect(clash.status).toBe(409);
    expect(clash.json.error.code).toBe("DUPLICATE_CHART_NO");

    const missingId = "01900000-0000-7000-8000-000000000000";
    const missing = await callRoute(PATCH, {
      method: "PATCH",
      url: `/api/patients/${missingId}`,
      cookie,
      params: { id: missingId },
      body: { memo: "x" },
    });
    expect(missing.status).toBe(404);

    const doctor = await loginAs("DOCTOR");
    const denied = await callRoute(PATCH, {
      method: "PATCH",
      url: `/api/patients/${id}`,
      cookie: doctor.cookie,
      params: { id },
      body: { memo: "x" },
    });
    expect(denied.status).toBe(403);
  });
});

describe("고객 상세", () => {
  it("예약 이력을 최근 순으로 돌려주고 PATIENT_READ 감사 행을 쓴다", async () => {
    const { cookie } = await loginAs("FRONT");
    const patient = await createPatient({ ...sealPhone(PHONE), name: "가상이력" });
    await createAppointment({ patientId: patient.id, startAt: new Date("2026-10-01T01:00:00Z"), chair: "C1" });
    await createAppointment({ patientId: patient.id, startAt: new Date("2026-11-20T01:00:00Z"), chair: "C2", status: "BOOKED" });

    const res = await callRoute(getOne, { url: `/api/patients/${patient.id}`, cookie, params: { id: patient.id } });
    expect(res.status).toBe(200);
    expect(res.json.appointments.map((a: { chair: string }) => a.chair)).toEqual(["C2", "C1"]);
    expect(res.json.appointments[0]).toMatchObject({ status: "BOOKED", treatmentItem: "정기검진", durationMin: 30 });

    const [row] = await auditRows("PATIENT_READ");
    expect(row).toMatchObject({ result: "SUCCESS", patientId: patient.id });
    expect(row.detail).toMatchObject({ patientCount: 1 });
  });

  it("없는 고객은 404, 잘못된 id는 400", async () => {
    const { cookie } = await loginAs("FRONT");
    const id = "01900000-0000-7000-8000-000000000000";
    expect((await callRoute(getOne, { url: `/api/patients/${id}`, cookie, params: { id } })).status).toBe(404);
    expect((await callRoute(getOne, { url: "/api/patients/x", cookie, params: { id: "x" } })).status).toBe(400);
  });
});

describe("T3-2 고객 검색", () => {
  async function seedSearchPatients() {
    const { cookie } = await loginAs("FRONT");
    const hong = await register(cookie, { name: "가상홍길", phone: "010-0123-4567", birthDate: "1980-07-07", dentwebChartNo: "F100001" });
    const kim = await register(cookie, { name: "가상김철", phone: "010-0987-4567", dentwebChartNo: "F100002" });
    const lee = await register(cookie, { name: "Virtual Lee", phone: "010-0555-1212" });
    return { cookie, hong: hong.json.id as string, kim: kim.json.id as string, lee: lee.json.id as string };
  }

  const ids = (res: { json: { items: { id: string }[] } }) => res.json.items.map((item) => item.id).sort();
  const find = (cookie: string, q: string) =>
    callRoute(search, { url: `/api/patients?q=${encodeURIComponent(q)}`, cookie });

  it("뒷 4자리로 찾는다 (같은 뒷자리 여러 명)", async () => {
    const { cookie, hong, kim } = await seedSearchPatients();
    expect(ids(await find(cookie, "4567"))).toEqual([hong, kim].sort());
    expect(ids(await find(cookie, " 1212 "))).toHaveLength(1);
    expect(ids(await find(cookie, "9999"))).toEqual([]);
  });

  it("전체 번호는 여러 표기로 찾는다", async () => {
    const { cookie, hong } = await seedSearchPatients();
    for (const q of ["010-0123-4567", "01001234567", "010 0123 4567", "+82 10-0123-4567", "(010)0123-4567"]) {
      expect(ids(await find(cookie, q)), q).toEqual([hong]);
    }
  });

  it("이름 일부로 찾는다 (대소문자 무시)", async () => {
    const { cookie, hong, kim, lee } = await seedSearchPatients();
    expect(ids(await find(cookie, "홍길"))).toEqual([hong]);
    expect(ids(await find(cookie, "가상"))).toEqual([hong, kim].sort());
    expect(ids(await find(cookie, "virtual lee"))).toEqual([lee]);
  });

  it("차트번호로 찾는다 (정확히 일치)", async () => {
    const { cookie, kim } = await seedSearchPatients();
    expect(ids(await find(cookie, "F100002"))).toEqual([kim]);
    expect(ids(await find(cookie, "f100002"))).toEqual([kim]);
    expect(ids(await find(cookie, "F10000"))).toEqual([]);
  });

  it("숫자만 있는 차트번호도 찾는다 (뒷 4자리·전체 번호 모양이어도)", async () => {
    const { cookie, hong, kim } = await seedSearchPatients();
    const four = await register(cookie, { name: "가상숫자", phone: "010-0222-5678", dentwebChartNo: "1234" });
    const long = await register(cookie, { name: "가상긴차트", phone: "010-0333-5678", dentwebChartNo: "0312345678" });
    expect(ids(await find(cookie, "1234"))).toEqual([four.json.id]);
    expect(ids(await find(cookie, "0312345678"))).toEqual([long.json.id]);
    // 번호 검색은 그대로 동작한다: 4567은 번호 뒷자리, 5678은 두 고객의 번호 뒷자리
    expect(ids(await find(cookie, "4567"))).toEqual([hong, kim].sort());
    expect(ids(await find(cookie, "5678"))).toEqual([four.json.id, long.json.id].sort());
  });

  it("빈 검색어는 최근 등록 순, limit을 지킨다", async () => {
    const { cookie, lee, kim } = await seedSearchPatients();
    const res = await callRoute(search, { url: "/api/patients?limit=2", cookie });
    expect(res.json.items.map((i: { id: string }) => i.id)).toEqual([lee, kim]);
    expect((await callRoute(search, { url: "/api/patients?limit=51", cookie })).status).toBe(400);
  });

  it("목록은 마스킹한다 — 응답에 이름 원문·전체 번호가 없다", async () => {
    const { cookie, hong } = await seedSearchPatients();
    const res = await find(cookie, "4567");
    const item = res.json.items.find((i: { id: string }) => i.id === hong);
    expect(item).toEqual({
      id: hong,
      nameMasked: "가**길",
      phoneMasked: "010-****-4567",
      birthYear: 1980,
      gender: null,
      visitType: "NEW",
      referralSource: null,
      tags: [],
      dentwebChartNo: "F100001",
      noShowCount: 0,
    });
    for (const secret of ["가상홍길", "가상김철", "0123-4567", "0987-4567", "01001234567", "01009874567", "1980-07-07", "phoneEnc", "v1."]) {
      expect(res.text).not.toContain(secret);
    }
  });

  it("검색마다 PATIENT_SEARCH 감사 행 하나: 건수와 검색 방식 코드만, 검색어는 없다", async () => {
    const { cookie, hong } = await seedSearchPatients();
    await find(cookie, "4567");
    await find(cookie, "홍길");
    const rows = await auditRows("PATIENT_SEARCH");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ result: "SUCCESS", patientId: null });
    expect(rows[0].detail).toEqual({ patientCount: 2, searchKind: "last4" });
    expect(rows[1]).toMatchObject({ patientId: hong });
    expect(rows[1].detail).toEqual({ patientCount: 1, searchKind: "name" });
    expect(JSON.stringify(rows)).not.toContain("홍길");
  });
});

describe("T3-2 완료 기준 — 가짜 데이터 500명에서 0.5초 이내", () => {
  it(
    "뒷 4자리·전체 번호·이름·차트번호 검색 각 20회의 p95가 500ms 미만",
    async () => {
      await createStaff({ loginId: "doctor1", role: "DOCTOR" });
      await createStaff({ loginId: "doctor2", role: "DOCTOR" });
      await createStaff({ loginId: "front1", role: "FRONT" });
      const data = generateFakeData({
        seed: 20261111,
        now: new Date("2026-11-11T05:00:00.000Z"),
        patientCount: 500,
        doctorKeys: FAKE_DOCTOR_KEYS,
        frontKeys: FAKE_FRONT_KEYS,
      });
      const summary = await insertFakeData(db, data, { env: { FAKE_DATA_ALLOWED: "true" } });
      expect(summary.patients).toBe(500);

      const { cookie } = await loginAs("FRONT");
      const sample = data.patients.filter((p) => p.dentwebChartNo).slice(0, 20);
      const formats = [(p: string) => p, formatPhone, (p: string) => formatPhone(p).replaceAll("-", " ")];
      const queries: Record<string, string[]> = {
        last4: sample.map((p) => p.phone.slice(-4)),
        phone: sample.map((p, i) => formats[i % formats.length](p.phone)),
        name: sample.map((p) => p.name.slice(1)),
        chart: sample.map((p) => p.dentwebChartNo as string),
      };

      const report: Record<string, { p50: number; p95: number; max: number }> = {};
      for (const [kind, list] of Object.entries(queries)) {
        const times: number[] = [];
        for (const q of list) {
          const started = performance.now();
          const res = await callRoute(search, { url: `/api/patients?q=${encodeURIComponent(q)}&limit=50`, cookie });
          times.push(performance.now() - started);
          expect(res.status).toBe(200);
          expect(res.json.items.length, kind).toBeGreaterThan(0);
        }
        times.sort((a, b) => a - b);
        const at = (ratio: number) => times[Math.min(times.length - 1, Math.ceil(ratio * times.length) - 1)];
        report[kind] = { p50: round(at(0.5)), p95: round(at(0.95)), max: round(times[times.length - 1]) };
      }
      console.log(`T3-2 검색 응답 시간(ms, 환자 ${summary.patients}명, 각 20회): ${JSON.stringify(report)}`);
      for (const [kind, stats] of Object.entries(report)) expect(stats.p95, kind).toBeLessThan(500);
    },
    120_000,
  );
});

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}
