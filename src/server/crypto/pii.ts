import "server-only";

/**
 * 개인정보 컬럼 암호화 — 전화번호·생년월일 (기획서 6장, 10장).
 *
 * - 암호화: AES-256-GCM. 저장 형식은 "v1.<iv>.<암호문>.<tag>" (각 부분은 base64url).
 *   IV는 매번 새로 뽑으므로 같은 값도 저장할 때마다 다른 문자열이 된다.
 *   context("patient.phone" 등)를 추가 인증 데이터로 묶어, 다른 컬럼에 복사한 암호문은 복호화되지 않는다.
 *   "v1"은 키·형식 버전이다. 키를 교체할 때 새 버전을 추가하고 옛 버전은 읽기만 한다.
 *   암호문은 컬럼에만 묶이고 행(환자 id)에는 묶이지 않는다. 키 없이 DB에 쓸 수 있는 사람이
 *   한 환자의 암호문을 다른 환자 행의 같은 컬럼에 복사하면 그대로 복호화된다.
 * - 검색: 암호문으로는 검색할 수 없으므로 HMAC-SHA256 해시를 따로 저장한다.
 *   같은 번호는 같은 해시가 되므로 전체 번호·뒷 4자리 검색과 중복 경고가 가능하다.
 *
 * 검색용 해시의 한계 (알고 쓴다):
 * - 전화번호는 경우의 수가 적다(뒷 4자리는 1만 가지). DB와 PII_HMAC_KEY를 함께 가진 사람은
 *   모든 번호를 대입해 해시에서 번호를 되찾을 수 있다. 그래서 HMAC 키는 DB와 떨어진 곳
 *   (AWS Secrets Manager)에만 두고, DB 백업·덤프와 같은 곳에 보관하지 않는다.
 * - 암호화 키와 HMAC 키를 따로 두는 이유도 같다. 한쪽이 새어도 다른 쪽까지 풀리지 않게 한다.
 * - 키가 없어도 DB만 보면 '어느 행들이 같은 번호·같은 뒷자리인지'는 드러난다. 번호 자체는 알 수 없다.
 *
 * 키는 환경변수 PII_ENC_KEY, PII_HMAC_KEY로 받는다. 각각 무작위 32바이트의 base64 값이다.
 * 에러 메시지에는 키·평문·암호문을 넣지 않는다 (절대 규칙 6).
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { isLast4Query, normalizePhone, phoneLast4 } from "@/lib/phone";
import { type DateKey, isValidDateKey } from "@/lib/time/kst";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** 암호문을 컬럼에 묶는 context. 컬럼마다 다른 값을 쓴다. */
const PHONE_CONTEXT = "patient.phone";
const BIRTH_DATE_CONTEXT = "patient.birthDate";

/** 키 환경변수가 없거나 형식이 틀렸다 (설정 오류). */
export class PiiKeyError extends Error {
  readonly code = "PII_KEY_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "PiiKeyError";
  }
}

/** 복호화 실패. 변조·다른 컬럼·다른 키·형식 오류를 구분하지 않고 같은 문구만 쓴다. */
export class PiiDecryptError extends Error {
  readonly code = "PII_DECRYPT_FAILED";

  constructor() {
    super("암호화된 값을 복호화할 수 없습니다");
    this.name = "PiiDecryptError";
  }
}

export type PiiInputErrorCode = "INVALID_PHONE" | "INVALID_BIRTH_DATE";

const INPUT_ERROR_MESSAGE: Record<PiiInputErrorCode, string> = {
  INVALID_PHONE: "전화번호 형식이 올바르지 않습니다",
  INVALID_BIRTH_DATE: "생년월일 형식이 올바르지 않습니다 (YYYY-MM-DD)",
};

/** 암호화할 입력값이 올바르지 않다. 메시지에 입력값을 넣지 않는다. */
export class PiiInputError extends Error {
  constructor(readonly code: PiiInputErrorCode) {
    super(INPUT_ERROR_MESSAGE[code]);
    this.name = "PiiInputError";
  }
}

// ── 키 ──────────────────────────────────────────────────────────────

type KeyName = "PII_ENC_KEY" | "PII_HMAC_KEY";

const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** 검증을 마친 키. 환경변수 값이 그대로인 동안 다시 검증하지 않는다. */
const keyCache = new Map<KeyName, { source: string; key: Buffer }>();

function loadKey(name: KeyName): Buffer {
  const source = process.env[name]?.trim();
  if (!source) throw new PiiKeyError(`환경변수 ${name}가 없습니다`);

  const cached = keyCache.get(name);
  if (cached?.source === source) return cached.key;

  if (!BASE64_RE.test(source)) throw new PiiKeyError(`환경변수 ${name}는 base64 문자열이어야 합니다`);
  const key = Buffer.from(source, "base64");
  if (key.length !== KEY_BYTES) throw new PiiKeyError(`환경변수 ${name}는 32바이트 키의 base64 값이어야 합니다`);

  const otherName: KeyName = name === "PII_ENC_KEY" ? "PII_HMAC_KEY" : "PII_ENC_KEY";
  if (process.env[otherName]?.trim() === source) {
    throw new PiiKeyError(`환경변수 ${name}와 ${otherName}는 서로 다른 키여야 합니다`);
  }

  keyCache.set(name, { source, key });
  return key;
}

// ── 암호화 ──────────────────────────────────────────────────────────

type Payload = { iv: Buffer; ciphertext: Buffer; tag: Buffer };

/** base64url을 엄격하게 읽는다. 다시 인코딩했을 때 같은 문자열이 아니면 null. */
function decodeBase64Url(part: string): Buffer | null {
  const bytes = Buffer.from(part, "base64url");
  return bytes.toString("base64url") === part ? bytes : null;
}

function parsePayload(payload: unknown): Payload | null {
  if (typeof payload !== "string") return null;
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const iv = decodeBase64Url(parts[1]);
  const ciphertext = decodeBase64Url(parts[2]);
  const tag = decodeBase64Url(parts[3]);
  if (!iv || !ciphertext || !tag) return null;
  // tag 길이를 직접 확인한다. 짧게 자른 tag를 받아 주면 위조가 쉬워진다.
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
  return { iv, ciphertext, tag };
}

/**
 * 값을 암호화해 "v1.<iv>.<암호문>.<tag>" 문자열로 돌려준다.
 * context는 이 값이 들어갈 컬럼 이름이다 (예: "patient.phone"). 복호화할 때 같은 값을 줘야 한다.
 */
export function encryptPii(plaintext: string, context: string): string {
  // Node의 에러 메시지는 받은 값을 그대로 담는다. 문자열이 아닌 값은 여기서 먼저 막는다.
  if (typeof plaintext !== "string") throw new TypeError("plaintext는 문자열이어야 합니다");
  if (typeof context !== "string" || !context) throw new TypeError("context가 비어 있습니다");
  const key = loadKey("PII_ENC_KEY");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, ...[iv, ciphertext, cipher.getAuthTag()].map((part) => part.toString("base64url"))].join(".");
}

/**
 * encryptPii의 결과를 복호화한다.
 * 변조·다른 context·다른 키·다른 버전·형식 오류는 모두 PiiDecryptError 하나로 알린다.
 */
export function decryptPii(payload: string, context: string): string {
  const key = loadKey("PII_ENC_KEY");
  const parsed = parsePayload(payload);
  if (!parsed || typeof context !== "string" || !context) throw new PiiDecryptError();
  try {
    const decipher = createDecipheriv(ALGORITHM, key, parsed.iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(parsed.tag);
    return Buffer.concat([decipher.update(parsed.ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // 원인(Node의 인증 실패 에러)을 붙이지 않는다. 호출한 쪽에는 실패했다는 사실만 알린다.
    throw new PiiDecryptError();
  }
}

// ── 검색용 해시 ─────────────────────────────────────────────────────

/** 용도별 접두어를 붙여 HMAC을 계산한다. 접두어가 다르면 같은 숫자라도 해시가 다르다. */
function hmacHex(domain: "phone" | "phone-last4", value: string): string {
  return createHmac("sha256", loadKey("PII_HMAC_KEY")).update(`${domain}:${value}`, "utf8").digest("hex");
}

/**
 * 전체 번호 해시 (hex 64자). 정규화한 번호(normalizePhone의 결과)를 넣어야 한다.
 * 숫자만으로 된 값인지만 확인한다 — 하이픈이 섞인 값을 넣으면 검색·중복 검사가 조용히 빗나가기 때문이다.
 */
export function hashPhone(normalizedPhone: string): string {
  // 숫자(number)를 넣으면 앞의 0이 사라진 값이 해시된다. 문자열만 받는다.
  if (typeof normalizedPhone !== "string" || !/^\d+$/.test(normalizedPhone)) throw new PiiInputError("INVALID_PHONE");
  return hmacHex("phone", normalizedPhone);
}

/** 뒷 4자리 해시 (hex 64자). */
export function hashPhoneLast4(last4: string): string {
  if (typeof last4 !== "string" || !/^\d{4}$/.test(last4)) throw new PiiInputError("INVALID_PHONE");
  return hmacHex("phone-last4", last4);
}

// ── 앱에서 쓰는 함수 ────────────────────────────────────────────────

/** patient 테이블의 전화번호 세 컬럼에 저장할 값 */
export type SealedPhone = {
  phoneEnc: string;
  phoneHash: string;
  phoneLast4Hash: string;
};

/** 입력한 전화번호를 정규화해 암호문과 검색용 해시로 바꾼다. 형식이 틀리면 PiiInputError. */
export function sealPhone(input: string): SealedPhone {
  const normalized = typeof input === "string" ? normalizePhone(input) : null;
  if (!normalized) throw new PiiInputError("INVALID_PHONE");
  return {
    phoneEnc: encryptPii(normalized, PHONE_CONTEXT),
    phoneHash: hashPhone(normalized),
    phoneLast4Hash: hashPhoneLast4(phoneLast4(normalized)),
  };
}

/** phoneEnc → 정규화된 번호 ("01000001234") */
export function openPhone(phoneEnc: string): string {
  const phone = decryptPii(phoneEnc, PHONE_CONTEXT);
  if (normalizePhone(phone) !== phone) throw new PiiDecryptError();
  return phone;
}

/** 생년월일 "YYYY-MM-DD"를 암호문으로 바꾼다. 형식이 틀리거나 없는 날짜면 PiiInputError. */
export function sealBirthDate(dateKey: DateKey): string {
  if (!isValidDateKey(dateKey)) throw new PiiInputError("INVALID_BIRTH_DATE");
  return encryptPii(dateKey, BIRTH_DATE_CONTEXT);
}

/** birthDateEnc → "YYYY-MM-DD" */
export function openBirthDate(birthDateEnc: string): DateKey {
  const dateKey = decryptPii(birthDateEnc, BIRTH_DATE_CONTEXT);
  if (!isValidDateKey(dateKey)) throw new PiiDecryptError();
  return dateKey;
}

export type PhoneSearchHash = { kind: "full"; hash: string } | { kind: "last4"; hash: string };

/**
 * 검색어를 해시 컬럼 조건으로 바꾼다.
 * 숫자 4개 → 뒷 4자리(phoneLast4Hash), 전체 번호 → phoneHash, 그 밖에는 null(전화번호 검색이 아님).
 */
export function phoneSearchHash(query: string): PhoneSearchHash | null {
  if (isLast4Query(query)) return { kind: "last4", hash: hashPhoneLast4(query.trim()) };
  const normalized = normalizePhone(query);
  return normalized ? { kind: "full", hash: hashPhone(normalized) } : null;
}
