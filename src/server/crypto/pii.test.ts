import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  PiiDecryptError,
  PiiInputError,
  PiiKeyError,
  decryptPii,
  encryptPii,
  hashPhone,
  hashPhoneLast4,
  openBirthDate,
  openPhone,
  phoneSearchHash,
  sealBirthDate,
  sealPhone,
} from "./pii";

// 키는 테스트를 시작할 때마다 새로 만든다. 저장소에는 키 문자열을 두지 않는다.
const newKey = () => randomBytes(32).toString("base64");
const ENC_KEY = newKey();
const HMAC_KEY = newKey();

beforeEach(() => {
  process.env.PII_ENC_KEY = ENC_KEY;
  process.env.PII_HMAC_KEY = HMAC_KEY;
});

// 가짜 데이터: 전화번호는 배정되지 않는 010-0XXX-XXXX 대역만 쓴다.
const PHONE = "010-0000-1234";
const PHONE_NORMALIZED = "01000001234";
const BIRTH_DATE = "1990-03-15";

function thrownBy(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error("예외가 발생하지 않았다");
}

/** "v1.<iv>.<ciphertext>.<tag>"의 한 부분을 바꾼 값을 만든다. */
function replacePart(payload: string, index: number, change: (bytes: Buffer) => Buffer): string {
  const parts = payload.split(".");
  parts[index] = change(Buffer.from(parts[index], "base64url")).toString("base64url");
  return parts.join(".");
}

/** 모듈을 거치지 않고 node:crypto로 직접 푼다: AES-256-GCM, 32바이트 키 전체, tag 16바이트, AAD = context. */
function rawDecrypt(payload: string, context: string, keyBase64 = ENC_KEY): string {
  const [, iv, ciphertext, tag] = payload.split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keyBase64, "base64"), iv, { authTagLength: 16 });
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** 모듈을 거치지 않고 node:crypto로 직접 만든 payload */
function rawEncrypt(plaintext: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(ENC_KEY, "base64"), iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", ...[iv, ciphertext, cipher.getAuthTag()].map((part) => part.toString("base64url"))].join(".");
}

/** 암호문 부분(바이트)에 평문이 그대로 들어 있지 않은지 확인한다. */
function expectCiphertextHides(payload: string, plaintext: string) {
  const ciphertext = Buffer.from(payload.split(".")[2], "base64url");
  expect(ciphertext).toHaveLength(Buffer.byteLength(plaintext, "utf8"));
  expect(ciphertext.equals(Buffer.from(plaintext, "utf8"))).toBe(false);
  expect(ciphertext.toString("latin1")).not.toContain(plaintext);
}

describe("알고리즘 고정 — node:crypto로 직접 검증한다", () => {
  it("encryptPii의 결과는 AES-256-GCM(32바이트 키 전체, AAD = context)으로 풀린다", () => {
    expect(rawDecrypt(encryptPii(PHONE_NORMALIZED, "patient.phone"), "patient.phone")).toBe(PHONE_NORMALIZED);
    expect(rawDecrypt(encryptPii("가나다 abc", "test.text"), "test.text")).toBe("가나다 abc");
  });

  it("키의 어느 바이트가 달라도 풀리지 않는다 (32바이트를 모두 쓴다)", () => {
    const payload = encryptPii(PHONE_NORMALIZED, "patient.phone");
    for (let i = 0; i < 32; i++) {
      const key = Buffer.from(ENC_KEY, "base64");
      key[i] ^= 0x01;
      expect(() => rawDecrypt(payload, "patient.phone", key.toString("base64"))).toThrow();
      process.env.PII_ENC_KEY = key.toString("base64");
      expect(() => decryptPii(payload, "patient.phone")).toThrow(PiiDecryptError);
    }
  });

  it("node:crypto로 직접 만든 AES-256-GCM payload를 decryptPii·openPhone·openBirthDate가 연다", () => {
    expect(decryptPii(rawEncrypt("가나다 abc", "test.text"), "test.text")).toBe("가나다 abc");
    expect(openPhone(rawEncrypt(PHONE_NORMALIZED, "patient.phone"))).toBe(PHONE_NORMALIZED);
    expect(openBirthDate(rawEncrypt(BIRTH_DATE, "patient.birthDate"))).toBe(BIRTH_DATE);
  });

  it("sealPhone은 patient.phone, sealBirthDate는 patient.birthDate에 묶인다", () => {
    const phoneEnc = sealPhone(PHONE).phoneEnc;
    const birthDateEnc = sealBirthDate(BIRTH_DATE);
    expect(rawDecrypt(phoneEnc, "patient.phone")).toBe(PHONE_NORMALIZED);
    expect(rawDecrypt(birthDateEnc, "patient.birthDate")).toBe(BIRTH_DATE);
    expect(decryptPii(phoneEnc, "patient.phone")).toBe(PHONE_NORMALIZED);
    expect(decryptPii(birthDateEnc, "patient.birthDate")).toBe(BIRTH_DATE);
    // 두 컬럼의 context가 서로 다르다: 바꿔서 주면 인증 단계에서 실패한다.
    expect(() => decryptPii(phoneEnc, "patient.birthDate")).toThrow(PiiDecryptError);
    expect(() => decryptPii(birthDateEnc, "patient.phone")).toThrow(PiiDecryptError);
    expect(() => rawDecrypt(birthDateEnc, "patient.phone")).toThrow();
  });

  it("IV 12바이트가 모두 무작위다 (어느 자리도 고정돼 있지 않다)", () => {
    const ivs = Array.from({ length: 200 }, () =>
      Buffer.from(encryptPii(PHONE_NORMALIZED, "patient.phone").split(".")[1], "base64url"),
    );
    expect(new Set(ivs.map((iv) => iv.toString("hex"))).size).toBe(ivs.length);
    for (let position = 0; position < 12; position++) {
      // 무작위 바이트라면 200번 중 서로 다른 값이 100가지쯤 나온다. 고정되거나 좁은 범위면 걸린다.
      expect(new Set(ivs.map((iv) => iv[position])).size).toBeGreaterThan(32);
    }
  });
});

describe("encryptPii / decryptPii", () => {
  it("암호화한 값을 같은 context로 복호화하면 원문이 나온다", () => {
    const payload = encryptPii(PHONE_NORMALIZED, "patient.phone");
    expect(decryptPii(payload, "patient.phone")).toBe(PHONE_NORMALIZED);
  });

  it("형식은 v1.<iv 12바이트>.<암호문>.<tag 16바이트> (base64url)", () => {
    const parts = encryptPii(PHONE_NORMALIZED, "patient.phone").split(".");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
    for (const part of parts.slice(1)) expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(parts[1], "base64url")).toHaveLength(12);
    expect(Buffer.from(parts[2], "base64url")).toHaveLength(PHONE_NORMALIZED.length);
    expect(Buffer.from(parts[3], "base64url")).toHaveLength(16);
  });

  it("저장되는 값에 평문이 들어 있지 않다", () => {
    const payload = encryptPii(PHONE_NORMALIZED, "patient.phone");
    expect(payload).not.toContain(PHONE_NORMALIZED);
    const ciphertext = Buffer.from(payload.split(".")[2], "base64url");
    expect(ciphertext.equals(Buffer.from(PHONE_NORMALIZED, "utf8"))).toBe(false);
    expect(ciphertext.toString("latin1")).not.toContain(PHONE_NORMALIZED);
  });

  it("같은 값을 두 번 암호화하면 결과가 다르고(IV 무작위) 둘 다 복호화된다", () => {
    const first = encryptPii(PHONE_NORMALIZED, "patient.phone");
    const second = encryptPii(PHONE_NORMALIZED, "patient.phone");
    expect(first).not.toBe(second);
    expect(first.split(".")[1]).not.toBe(second.split(".")[1]);
    expect(decryptPii(first, "patient.phone")).toBe(PHONE_NORMALIZED);
    expect(decryptPii(second, "patient.phone")).toBe(PHONE_NORMALIZED);
  });

  it("한글과 빈 문자열도 왕복한다", () => {
    expect(decryptPii(encryptPii("가나다 abc 123", "test.text"), "test.text")).toBe("가나다 abc 123");
    expect(decryptPii(encryptPii("", "test.text"), "test.text")).toBe("");
  });

  it("context가 비어 있으면 암호화하지 않는다", () => {
    expect(() => encryptPii(PHONE_NORMALIZED, "")).toThrow(TypeError);
    expect(() => encryptPii(PHONE_NORMALIZED, undefined as unknown as string)).toThrow(TypeError);
  });

  it("문자열이 아닌 평문은 거부하고, 값을 메시지에 넣지 않는다", () => {
    // 타입을 건너뛴 호출(검증하지 않은 JSON 값 등). Node의 에러는 받은 값을 메시지에 담는다.
    for (const value of [1000001234, true, null, undefined, { phone: PHONE }, [PHONE_NORMALIZED]]) {
      const error = thrownBy(() => encryptPii(value as unknown as string, "patient.phone"));
      expect(error).toBeInstanceOf(TypeError);
      const text = `${error.message} ${error.stack ?? ""}`;
      expect(error.message).not.toMatch(/\d/);
      expect(text).not.toContain("1000001234");
      expect(text).not.toContain(PHONE);
      expect(text).not.toContain(PHONE_NORMALIZED);
    }
  });
});

describe("변조·오용 시 복호화 실패", () => {
  function expectGenericFailure(payload: string, context = "patient.phone") {
    const error = thrownBy(() => decryptPii(payload, context));
    expect(error).toBeInstanceOf(PiiDecryptError);
    return error;
  }

  it("payload의 어느 글자를 바꿔도 실패한다 (버전·iv·암호문·tag·구분점)", () => {
    const payload = encryptPii(PHONE_NORMALIZED, "patient.phone");
    for (let i = 0; i < payload.length; i++) {
      const replacement = payload[i] === "A" ? "B" : "A";
      const tampered = payload.slice(0, i) + replacement + payload.slice(i + 1);
      expectGenericFailure(tampered);
    }
  });

  it("iv·암호문·tag의 비트를 하나씩 뒤집으면 실패한다", () => {
    const payload = encryptPii(PHONE_NORMALIZED, "patient.phone");
    for (const index of [1, 2, 3]) {
      const tampered = replacePart(payload, index, (bytes) => {
        bytes[0] ^= 0x01;
        return bytes;
      });
      expectGenericFailure(tampered);
    }
  });

  it("tag를 짧게 자른 값은 받지 않는다", () => {
    const payload = encryptPii(PHONE_NORMALIZED, "patient.phone");
    for (const length of [0, 4, 8, 12, 15]) {
      expectGenericFailure(replacePart(payload, 3, (tag) => tag.subarray(0, length)));
    }
  });

  it("iv 길이가 12바이트가 아니면 받지 않는다", () => {
    const payload = encryptPii(PHONE_NORMALIZED, "patient.phone");
    expectGenericFailure(replacePart(payload, 1, (iv) => iv.subarray(0, 11)));
    expectGenericFailure(replacePart(payload, 1, (iv) => Buffer.concat([iv, Buffer.alloc(4)])));
  });

  it("같은 바이트로 읽히는 비표준 base64url 표기는 받지 않는다", () => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const payload = encryptPii(PHONE_NORMALIZED, "patient.phone");
    // tag(16바이트)의 마지막 글자는 아래 4비트를 쓰지 않는다. 그 비트만 바꾼 표기를 만든다.
    const variant = payload.slice(0, -1) + alphabet[alphabet.indexOf(payload.slice(-1)) + 1];
    const tagOf = (value: string) => Buffer.from(value.split(".")[3], "base64url");
    expect(tagOf(variant).equals(tagOf(payload))).toBe(true);
    expectGenericFailure(variant);
    // base64url에 없는 글자가 섞인 값
    expectGenericFailure(payload.replace(".", ".!"));
    expectGenericFailure(`${payload}\n`);
  });

  it("버전이 다르면 실패한다", () => {
    const payload = encryptPii(PHONE_NORMALIZED, "patient.phone");
    expectGenericFailure(payload.replace(/^v1\./, "v2."));
    expectGenericFailure(payload.replace(/^v1\./, "."));
  });

  it("다른 context로는 복호화되지 않는다 (다른 컬럼에 복사한 암호문)", () => {
    const payload = encryptPii(PHONE_NORMALIZED, "patient.phone");
    expectGenericFailure(payload, "patient.birthDate");
    expectGenericFailure(payload, "patient.phone ");
    expectGenericFailure(payload, "");
  });

  it("다른 키로는 복호화되지 않는다", () => {
    const payload = encryptPii(PHONE_NORMALIZED, "patient.phone");
    process.env.PII_ENC_KEY = newKey();
    expectGenericFailure(payload);
    // 원래 키로 돌아오면 다시 복호화된다.
    process.env.PII_ENC_KEY = ENC_KEY;
    expect(decryptPii(payload, "patient.phone")).toBe(PHONE_NORMALIZED);
  });

  it("형식이 깨진 입력은 실패한다", () => {
    const payload = encryptPii(PHONE_NORMALIZED, "patient.phone");
    const malformed = [
      "",
      "v1",
      "v1...",
      "v1.a.b",
      "암호문 아님",
      PHONE_NORMALIZED,
      `${payload}.AAAA`,
      `${payload}=`,
      ` ${payload}`,
      payload.replaceAll(".", ":"),
    ];
    for (const value of malformed) expectGenericFailure(value);
    expectGenericFailure(null as unknown as string);
    expectGenericFailure(undefined as unknown as string);
  });

  it("에러 메시지에 평문·payload·키가 들어 있지 않다", () => {
    const payload = encryptPii(PHONE_NORMALIZED, "patient.phone");
    const tampered = replacePart(payload, 2, (bytes) => {
      bytes[0] ^= 0xff;
      return bytes;
    });
    const errors = [
      expectGenericFailure(tampered),
      expectGenericFailure(payload, "patient.birthDate"),
      expectGenericFailure(PHONE_NORMALIZED),
    ];
    const generic = errors[0].message;
    for (const error of errors) {
      // 원인이 무엇이든 같은 문구 하나만 쓴다.
      expect(error.message).toBe(generic);
      expect(error.cause).toBeUndefined();
      expect(error.message).not.toMatch(/\d/);
      const text = `${error.name} ${error.message} ${error.stack ?? ""}`;
      expect(text).not.toContain(PHONE_NORMALIZED);
      expect(text).not.toContain(payload);
      expect(text).not.toContain(tampered);
      for (const part of payload.split(".").slice(1)) expect(text).not.toContain(part);
      expect(text).not.toContain(ENC_KEY);
      expect(text).not.toContain(HMAC_KEY);
    }
  });
});

describe("hashPhone / hashPhoneLast4", () => {
  it("같은 입력이면 항상 같은 해시가 나온다", () => {
    expect(hashPhone(PHONE_NORMALIZED)).toBe(hashPhone(PHONE_NORMALIZED));
    expect(hashPhoneLast4("1234")).toBe(hashPhoneLast4("1234"));
  });

  it("다른 번호는 다른 해시가 나온다", () => {
    expect(hashPhone("01000001234")).not.toBe(hashPhone("01000001235"));
    expect(hashPhoneLast4("1234")).not.toBe(hashPhoneLast4("1235"));
  });

  it("HMAC-SHA256 결과를 hex 64자로 돌려준다", () => {
    expect(hashPhone(PHONE_NORMALIZED)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPhoneLast4("1234")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("같은 숫자라도 전체 해시와 뒷 4자리 해시는 다르다 (용도 구분)", () => {
    expect(hashPhone("1234")).not.toBe(hashPhoneLast4("1234"));
  });

  it("용도별 접두어를 붙여 PII_HMAC_KEY로 계산한다", () => {
    const hmac = (input: string) =>
      createHmac("sha256", Buffer.from(HMAC_KEY, "base64")).update(input, "utf8").digest("hex");
    expect(hashPhone(PHONE_NORMALIZED)).toBe(hmac(`phone:${PHONE_NORMALIZED}`));
    expect(hashPhoneLast4("1234")).toBe(hmac("phone-last4:1234"));
  });

  it("HMAC 키가 바뀌면 해시도 바뀐다", () => {
    const full = hashPhone(PHONE_NORMALIZED);
    const last4 = hashPhoneLast4("1234");
    process.env.PII_HMAC_KEY = newKey();
    expect(hashPhone(PHONE_NORMALIZED)).not.toBe(full);
    expect(hashPhoneLast4("1234")).not.toBe(last4);
  });

  it("암호화 키와는 무관하다", () => {
    const full = hashPhone(PHONE_NORMALIZED);
    process.env.PII_ENC_KEY = newKey();
    expect(hashPhone(PHONE_NORMALIZED)).toBe(full);
  });

  it("해시에 번호가 그대로 들어 있지 않다", () => {
    expect(hashPhone(PHONE_NORMALIZED)).not.toContain(PHONE_NORMALIZED);
  });

  it("숫자만으로 된 값이 아니면 거부하고, 입력값을 메시지에 넣지 않는다", () => {
    for (const value of [PHONE, "+82 10-0000-1234", "", " 01000001234"]) {
      const error = thrownBy(() => hashPhone(value));
      expect(error).toBeInstanceOf(PiiInputError);
      expect((error as PiiInputError).code).toBe("INVALID_PHONE");
      if (value.trim()) expect(error.message).not.toContain(value.trim());
    }
    for (const value of ["123", "12345", "12a4", "", PHONE_NORMALIZED]) {
      const error = thrownBy(() => hashPhoneLast4(value));
      expect(error).toBeInstanceOf(PiiInputError);
      expect((error as PiiInputError).code).toBe("INVALID_PHONE");
    }
  });

  it("문자열이 아닌 값은 해시하지 않는다 (숫자는 앞의 0이 사라진다)", () => {
    for (const value of [1000001234, 1234, null, undefined, ["01000001234"]]) {
      for (const hash of [hashPhone, hashPhoneLast4]) {
        const error = thrownBy(() => hash(value as unknown as string));
        expect(error).toBeInstanceOf(PiiInputError);
        expect((error as PiiInputError).code).toBe("INVALID_PHONE");
        expect(`${error.message} ${error.stack ?? ""}`).not.toMatch(/1000001234|1234/);
      }
    }
  });
});

describe("sealPhone / openPhone", () => {
  it("암호문과 두 가지 검색용 해시를 만든다", () => {
    const sealed = sealPhone(PHONE);
    expect(Object.keys(sealed).sort()).toEqual(["phoneEnc", "phoneHash", "phoneLast4Hash"]);
    expect(sealed.phoneEnc.startsWith("v1.")).toBe(true);
    expect(sealed.phoneHash).toBe(hashPhone(PHONE_NORMALIZED));
    expect(sealed.phoneLast4Hash).toBe(hashPhoneLast4("1234"));
  });

  it("복호화하면 정규화된 번호가 나온다", () => {
    expect(openPhone(sealPhone(PHONE).phoneEnc)).toBe(PHONE_NORMALIZED);
    expect(openPhone(sealPhone("+82 10-0000-1234").phoneEnc)).toBe(PHONE_NORMALIZED);
    expect(openPhone(sealPhone("02-000-1234").phoneEnc)).toBe("020001234");
  });

  it("저장되는 값 어디에도 번호가 평문으로 들어 있지 않다", () => {
    const stored = JSON.stringify(sealPhone(PHONE));
    expect(stored).not.toContain(PHONE_NORMALIZED);
    expect(stored).not.toContain(PHONE);
    expect(stored).not.toContain("0000-1234");
  });

  it("phoneEnc는 인코딩만 바꾼 값이 아니라 암호화 키 없이는 열 수 없는 암호문이다", () => {
    const { phoneEnc } = sealPhone(PHONE);
    expectCiphertextHides(phoneEnc, PHONE_NORMALIZED);
    process.env.PII_ENC_KEY = newKey();
    expect(() => openPhone(phoneEnc)).toThrow(PiiDecryptError);
    expect(() => decryptPii(phoneEnc, "patient.phone")).toThrow(PiiDecryptError);
  });

  it("문자열이 아닌 입력은 PiiInputError — 값을 메시지에 넣지 않는다", () => {
    for (const value of [1000001234, null, undefined, { phone: PHONE }]) {
      const error = thrownBy(() => sealPhone(value as unknown as string));
      expect(error).toBeInstanceOf(PiiInputError);
      expect(error.message).not.toMatch(/\d/);
    }
  });

  it("표기가 달라도 같은 번호면 해시가 같다 (중복 경고의 근거)", () => {
    const a = sealPhone("010-0000-1234");
    const b = sealPhone("01000001234");
    const c = sealPhone("+82 10-0000-1234");
    expect(a.phoneHash).toBe(b.phoneHash);
    expect(a.phoneHash).toBe(c.phoneHash);
    expect(a.phoneLast4Hash).toBe(c.phoneLast4Hash);
    // 암호문은 매번 다르다.
    expect(a.phoneEnc).not.toBe(b.phoneEnc);
  });

  it("형식이 맞지 않는 번호는 PiiInputError — 입력값을 메시지에 넣지 않는다", () => {
    for (const value of ["", "1234", "10-0000-1234", "010-0000-12345678", "전화없음"]) {
      const error = thrownBy(() => sealPhone(value));
      expect(error).toBeInstanceOf(PiiInputError);
      expect(error.name).toBe("PiiInputError");
      expect((error as PiiInputError).code).toBe("INVALID_PHONE");
      if (value) expect(error.message).not.toContain(value);
    }
  });

  it("전화번호 칸의 암호문이 아니면 열지 않는다", () => {
    expect(() => openPhone(sealBirthDate(BIRTH_DATE))).toThrow(PiiDecryptError);
    // 같은 context로 암호화했더라도 정규화된 번호가 아니면 거부한다.
    expect(() => openPhone(encryptPii(PHONE, "patient.phone"))).toThrow(PiiDecryptError);
    expect(() => openPhone("")).toThrow(PiiDecryptError);
  });
});

describe("sealBirthDate / openBirthDate", () => {
  it("암호화한 생년월일을 복호화하면 같은 날짜가 나온다", () => {
    const sealed = sealBirthDate(BIRTH_DATE);
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(openBirthDate(sealed)).toBe(BIRTH_DATE);
  });

  it("저장되는 값에 날짜가 평문으로 들어 있지 않다", () => {
    const sealed = sealBirthDate(BIRTH_DATE);
    expect(sealed).not.toContain(BIRTH_DATE);
    expect(sealed).not.toContain("19900315");
    expectCiphertextHides(sealed, BIRTH_DATE);
    process.env.PII_ENC_KEY = newKey();
    expect(() => openBirthDate(sealed)).toThrow(PiiDecryptError);
  });

  it("같은 날짜도 매번 다른 암호문이 된다", () => {
    const first = sealBirthDate(BIRTH_DATE);
    const second = sealBirthDate(BIRTH_DATE);
    expect(first).not.toBe(second);
    expect(openBirthDate(first)).toBe(BIRTH_DATE);
    expect(openBirthDate(second)).toBe(BIRTH_DATE);
  });

  it("형식이 틀리거나 없는 날짜는 PiiInputError — 입력값을 메시지에 넣지 않는다", () => {
    for (const value of ["", "19900315", "1990-3-15", "1990-02-30", "1990-13-01", "1990/03/15"]) {
      const error = thrownBy(() => sealBirthDate(value));
      expect(error).toBeInstanceOf(PiiInputError);
      expect((error as PiiInputError).code).toBe("INVALID_BIRTH_DATE");
      if (value) expect(error.message).not.toContain(value);
    }
  });

  it("생년월일 칸의 암호문이 아니면 열지 않는다", () => {
    expect(() => openBirthDate(sealPhone(PHONE).phoneEnc)).toThrow(PiiDecryptError);
    expect(() => openBirthDate(encryptPii("19900315", "patient.birthDate"))).toThrow(PiiDecryptError);
  });
});

describe("phoneSearchHash", () => {
  it("숫자 4개는 뒷 4자리 검색", () => {
    expect(phoneSearchHash("1234")).toEqual({ kind: "last4", hash: hashPhoneLast4("1234") });
    expect(phoneSearchHash(" 1234 ")).toEqual({ kind: "last4", hash: hashPhoneLast4("1234") });
  });

  it("전체 번호는 표기와 무관하게 전체 해시 검색", () => {
    const expected = { kind: "full", hash: hashPhone(PHONE_NORMALIZED) };
    expect(phoneSearchHash("010-0000-1234")).toEqual(expected);
    expect(phoneSearchHash("01000001234")).toEqual(expected);
    expect(phoneSearchHash("+82 10-0000-1234")).toEqual(expected);
  });

  it("그 밖의 검색어는 null (전화번호 검색이 아님)", () => {
    for (const query of ["", "   ", "123", "12345", "0000-1234", "010-0000", "가나다", "12a4"]) {
      expect(phoneSearchHash(query)).toBeNull();
    }
  });
});

describe("검색 시뮬레이션 — 저장된 값만으로 찾는다", () => {
  type Row = { id: number; phoneEnc: string; phoneHash: string; phoneLast4Hash: string };

  // 가짜 번호 30개: 010-0000-xxxx ~ 010-0029-xxxx. 10번째마다 뒷자리가 1234로 같다.
  const numbers = Array.from({ length: 30 }, (_, i) => {
    const middle = `0${String(i).padStart(3, "0")}`;
    const last = i % 10 === 0 ? "1234" : String(2000 + i);
    return `010-${middle}-${last}`;
  });

  function buildTable(): Row[] {
    return numbers.map((number, id) => ({ id, ...sealPhone(number) }));
  }

  /** DB의 WHERE phone_hash = $1 / WHERE phone_last4_hash = $1 에 해당한다. */
  function search(rows: Row[], query: string): Row[] {
    const criteria = phoneSearchHash(query);
    if (!criteria) return [];
    return rows.filter((row) =>
      criteria.kind === "full" ? row.phoneHash === criteria.hash : row.phoneLast4Hash === criteria.hash,
    );
  }

  it("테이블에는 번호가 평문으로 남지 않는다", () => {
    const stored = JSON.stringify(buildTable());
    for (const number of numbers) {
      expect(stored).not.toContain(number);
      expect(stored).not.toContain(number.replaceAll("-", ""));
    }
  });

  it("테이블의 phoneEnc는 모두 암호문이다 — 바이트에 번호가 없고, 키가 다르면 열리지 않는다", () => {
    const rows = buildTable();
    rows.forEach((row, id) => {
      const normalized = numbers[id].replaceAll("-", "");
      expectCiphertextHides(row.phoneEnc, normalized);
      expect(rawDecrypt(row.phoneEnc, "patient.phone")).toBe(normalized);
    });
    process.env.PII_ENC_KEY = newKey();
    for (const row of rows) expect(() => openPhone(row.phoneEnc)).toThrow(PiiDecryptError);
  });

  it("전체 번호 검색은 표기가 달라도 정확히 그 한 건만 찾는다", () => {
    const rows = buildTable();
    for (const query of ["010-0000-1234", "01000001234", "+82 10-0000-1234"]) {
      const found = search(rows, query);
      expect(found.map((row) => row.id)).toEqual([0]);
      expect(openPhone(found[0].phoneEnc)).toBe("01000001234");
    }
  });

  it("모든 번호를 자기 자신으로만 찾을 수 있다", () => {
    const rows = buildTable();
    numbers.forEach((number, id) => {
      expect(search(rows, number).map((row) => row.id)).toEqual([id]);
    });
  });

  it("뒷 4자리 검색은 그 뒷자리를 가진 행만 모두 찾는다", () => {
    const rows = buildTable();
    const found = search(rows, "1234");
    expect(found.map((row) => row.id)).toEqual([0, 10, 20]);
    expect(found.map((row) => openPhone(row.phoneEnc))).toEqual(["01000001234", "01000101234", "01000201234"]);

    expect(search(rows, "2007").map((row) => row.id)).toEqual([7]);
  });

  it("없는 번호·없는 뒷자리는 아무것도 찾지 않는다", () => {
    const rows = buildTable();
    expect(search(rows, "010-0999-1234")).toEqual([]);
    expect(search(rows, "9999")).toEqual([]);
    // 가운데 자리(0010)는 뒷자리가 아니므로 걸리지 않는다.
    expect(search(rows, "0010")).toEqual([]);
    expect(search(rows, "가나다")).toEqual([]);
  });

  it("HMAC 키가 다르면 같은 번호로도 찾지 못한다", () => {
    const rows = buildTable();
    process.env.PII_HMAC_KEY = newKey();
    expect(search(rows, "010-0000-1234")).toEqual([]);
    expect(search(rows, "1234")).toEqual([]);
  });
});

describe("키 검증", () => {
  const KEY_NAMES = ["PII_ENC_KEY", "PII_HMAC_KEY"] as const;
  const use = {
    PII_ENC_KEY: () => encryptPii(PHONE_NORMALIZED, "patient.phone"),
    PII_HMAC_KEY: () => hashPhone(PHONE_NORMALIZED),
  };

  function expectKeyError(name: (typeof KEY_NAMES)[number], badValue?: string) {
    const error = thrownBy(use[name]);
    expect(error).toBeInstanceOf(PiiKeyError);
    expect(error.name).toBe("PiiKeyError");
    expect(error.message).toContain(name);
    const text = `${error.message} ${error.stack ?? ""}`;
    if (badValue?.trim()) expect(text).not.toContain(badValue.trim());
    expect(text).not.toContain(ENC_KEY);
    expect(text).not.toContain(HMAC_KEY);
  }

  it.each(KEY_NAMES)("%s가 없으면 변수 이름을 알려 주는 에러", (name) => {
    delete process.env[name];
    expectKeyError(name);
    process.env[name] = "";
    expectKeyError(name);
    process.env[name] = "   ";
    expectKeyError(name);
  });

  it.each(KEY_NAMES)("%s가 base64가 아니면 에러 — 값은 메시지에 넣지 않는다", (name) => {
    const valid = randomBytes(32).toString("base64");
    const notBase64 = [
      "base64 아님!!",
      `${randomBytes(32).toString("base64url")}-_`, // base64url 문자
      valid.slice(0, -1), // 패딩 없음
      `${valid.slice(0, 20)} ${valid.slice(20)}`, // 가운데 공백
    ];
    for (const bad of notBase64) {
      process.env[name] = bad;
      expectKeyError(name, bad);
    }
  });

  it.each(KEY_NAMES)("%s가 32바이트가 아니면 에러 — 값은 메시지에 넣지 않는다", (name) => {
    const wrongLength = [16, 24, 31, 33, 64].map((length) => randomBytes(length).toString("base64"));
    wrongLength.push(randomBytes(32).toString("hex")); // hex 64자는 base64로 읽으면 48바이트
    for (const bad of wrongLength) {
      process.env[name] = bad;
      expectKeyError(name, bad);
    }
  });

  it("두 키가 같은 값이면 거부한다 (암호화와 HMAC은 서로 다른 키)", () => {
    process.env.PII_HMAC_KEY = ENC_KEY;
    expectKeyError("PII_HMAC_KEY");
    const shared = newKey();
    process.env.PII_ENC_KEY = shared;
    process.env.PII_HMAC_KEY = shared;
    expectKeyError("PII_ENC_KEY", shared);
  });

  it("복호화할 때도 키가 없으면 키 에러가 난다", () => {
    const payload = encryptPii(PHONE_NORMALIZED, "patient.phone");
    delete process.env.PII_ENC_KEY;
    expect(() => decryptPii(payload, "patient.phone")).toThrow(PiiKeyError);
  });

  it("sealPhone은 두 키가 모두 있어야 한다", () => {
    delete process.env.PII_HMAC_KEY;
    expect(() => sealPhone(PHONE)).toThrow(PiiKeyError);
    process.env.PII_HMAC_KEY = HMAC_KEY;
    delete process.env.PII_ENC_KEY;
    expect(() => sealPhone(PHONE)).toThrow(PiiKeyError);
  });

  it("잘못된 키를 고치면 다시 동작한다", () => {
    const payload = encryptPii(PHONE_NORMALIZED, "patient.phone");
    process.env.PII_ENC_KEY = "잘못된 값";
    expect(() => decryptPii(payload, "patient.phone")).toThrow(PiiKeyError);
    process.env.PII_ENC_KEY = ENC_KEY;
    expect(decryptPii(payload, "patient.phone")).toBe(PHONE_NORMALIZED);
  });

  it("줄바꿈이 붙은 키 값도 받는다 (비밀 저장소에서 읽은 값)", () => {
    const payload = encryptPii(PHONE_NORMALIZED, "patient.phone");
    process.env.PII_ENC_KEY = `${ENC_KEY}\n`;
    expect(decryptPii(payload, "patient.phone")).toBe(PHONE_NORMALIZED);
  });
});
