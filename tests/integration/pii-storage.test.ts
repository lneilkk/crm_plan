/**
 * T1-2 완료 기준 (DB 쪽) — 저장된 값이 평문이 아니고, 전화번호 전체·뒷 4자리로 찾을 수 있다.
 * 환자는 가짜 데이터 스크립트와 같은 경로(insertFakeData → sealPhone·sealBirthDate)로 넣는다.
 * 번호는 배정되지 않는 010-0XXX-XXXX 대역, 이름은 지어낸 것이다(절대 규칙 1).
 */
import { randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DateKey } from "@/lib/time/kst";
import { openBirthDate, openPhone, phoneSearchHash } from "@/server/crypto/pii";
import type { FakeData, FakePatient } from "../../scripts/fake-data/generate";
import { insertFakeData } from "../../scripts/fake-data/run";
import { db, resetDb } from "./helpers";

function fakePatient(key: number, name: string, phone: string, birthDate: DateKey): FakePatient {
  return {
    key,
    name,
    phone,
    birthDate,
    gender: "FEMALE",
    visitType: "NEW",
    referralSource: "PHONE",
    tags: ["가짜데이터"],
    dentwebChartNo: null,
    memo: null,
    noShowCount: 0,
  };
}

// 가족 두 명이 같은 번호, 한 명은 뒷 4자리만 같다
const PATIENTS = [
  fakePatient(0, "가상하나", "01000001234", "1987-04-23"),
  fakePatient(1, "가상두리", "01000001234", "1991-08-30"),
  fakePatient(2, "가상세찬", "01000011234", "1979-12-06"),
  fakePatient(3, "가상네온", "01000005678", "2003-02-17"),
];
const DATA: FakeData = { patients: PATIENTS, appointments: [], statusLogs: [] };

beforeAll(() => {
  // 키는 테스트마다 새로 만든다. 저장소에는 키 문자열을 두지 않는다.
  process.env.PII_ENC_KEY = randomBytes(32).toString("base64");
  process.env.PII_HMAC_KEY = randomBytes(32).toString("base64");
});

beforeEach(async () => {
  await resetDb();
  await insertFakeData(db, DATA, { env: { FAKE_DATA_ALLOWED: "true" } });
});

/** 이름 → id */
async function idsByName(): Promise<Map<string, string>> {
  const rows = await db.patient.findMany({ select: { id: true, name: true } });
  return new Map(rows.map((row) => [row.name, row.id]));
}

/** 검색어로 phoneSearchHash를 거쳐 찾은 환자 이름 (정렬) */
async function search(query: string): Promise<string[]> {
  const condition = phoneSearchHash(query);
  if (!condition) throw new Error("전화번호 검색어가 아니다");
  const where = condition.kind === "full" ? { phoneHash: condition.hash } : { phoneLast4Hash: condition.hash };
  const rows = await db.patient.findMany({ where, select: { name: true } });
  return rows.map((row) => row.name).sort();
}

describe("저장된 값", () => {
  it("phone_enc·birth_date_enc와 행 전체 어디에도 번호·생년월일 평문이 없다", async () => {
    const rows = await db.$queryRaw<{ name: string; phone_enc: string; birth_date_enc: string; row_text: string }[]>`
      SELECT p.name, p.phone_enc, p.birth_date_enc, p::text AS row_text FROM patient p
    `;
    expect(rows).toHaveLength(PATIENTS.length);
    for (const row of rows) {
      const patient = PATIENTS.find((p) => p.name === row.name) as FakePatient;
      const digits = patient.phone;
      const plaintexts = [
        digits, // 01000001234
        `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`, // 010-0000-1234
        digits.slice(3), // 가운데+뒷자리 00001234
        patient.birthDate, // 1987-04-23
        patient.birthDate.replaceAll("-", ""), // 19870423
      ];
      for (const plaintext of plaintexts) {
        expect(row.phone_enc).not.toContain(plaintext);
        expect(row.birth_date_enc).not.toContain(plaintext);
        expect(row.row_text).not.toContain(plaintext);
      }
      expect(row.phone_enc).toMatch(/^v1\./);
      expect(row.birth_date_enc).toMatch(/^v1\./);
      // 키로는 원래 값을 되찾는다
      expect(openPhone(row.phone_enc)).toBe(digits);
      expect(openBirthDate(row.birth_date_enc)).toBe(patient.birthDate);
    }
  });

  it("같은 번호도 암호문은 다르고, 검색용 해시는 같다", async () => {
    const ids = await idsByName();
    const [a, b] = await Promise.all(
      ["가상하나", "가상두리"].map((name) => db.patient.findUniqueOrThrow({ where: { id: ids.get(name) } })),
    );
    expect(a.phoneEnc).not.toBe(b.phoneEnc);
    expect(a.phoneHash).toBe(b.phoneHash);
    expect(a.phoneLast4Hash).toBe(b.phoneLast4Hash);
  });
});

describe("전화번호 검색 (phoneSearchHash)", () => {
  it.each(["010-0000-1234", "01000001234", "010 0000 1234", "+82 10-0000-1234", " 010.0000.1234 "])(
    "전체 번호 %s로 같은 번호를 쓰는 환자를 모두 찾는다",
    async (query) => {
      expect(await search(query)).toEqual(["가상두리", "가상하나"]);
    },
  );

  it("뒷 4자리로 번호 끝이 같은 환자를 모두 찾는다", async () => {
    expect(await search("1234")).toEqual(["가상두리", "가상세찬", "가상하나"]);
    expect(await search("5678")).toEqual(["가상네온"]);
  });

  it("틀린 번호·뒷자리로는 아무도 찾지 못한다", async () => {
    expect(await search("010-0000-9999")).toEqual([]);
    expect(await search("010-0001-1235")).toEqual([]);
    expect(await search("9999")).toEqual([]);
  });
});
