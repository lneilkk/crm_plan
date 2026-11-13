/**
 * 전화번호 정규화·표시.
 *
 * 저장·검색·중복 검사는 항상 정규화한 값(숫자만, 0으로 시작)으로 한다.
 * 화면 목록에는 마스킹한 값만 보여 준다 (src/lib/masking.ts).
 */

/** 국내 전화번호: 0으로 시작하는 9~11자리 (휴대폰 010…, 지역번호 02·031…, 070 등) */
const NORMALIZED_PHONE_RE = /^0\d{8,10}$/;

/**
 * 입력값을 숫자만 남긴 국내 번호로 바꾼다. 형식이 맞지 않으면 null.
 * "010-1234-5678", "010 1234 5678", "+82 10-1234-5678" → "01012345678"
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  // 숫자와 흔한 구분 기호만 받는다. 다른 글자(전각 숫자 등)를 지우고 남은 숫자로 만들면 다른 사람 번호가 될 수 있다.
  if (!/^\+?[0-9\s().-]+$/.test(trimmed)) return null;
  let digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+82")) {
    // 국가번호 표기: "+82 10-…" 또는 "+82 010-…" 둘 다 받아 0으로 시작하게 맞춘다.
    digits = digits.slice(2);
    if (!digits.startsWith("0")) digits = `0${digits}`;
  }
  if (!NORMALIZED_PHONE_RE.test(digits)) return null;
  // 010 휴대폰은 항상 11자리다. 한 자리 빠진 010 번호를 다른 번호로 받아들이지 않는다.
  if (digits.startsWith("010") && digits.length !== 11) return null;
  return digits;
}

/** 정규화된 번호의 뒷 4자리 */
export function phoneLast4(normalized: string): string {
  return normalized.slice(-4);
}

/** 뒷 4자리 검색어인지 (숫자 4개) */
export function isLast4Query(input: string): boolean {
  return /^\d{4}$/.test(input.trim());
}

/** 정규화된 번호를 앞·가운데·뒤 세 부분으로 나눈다. */
function splitPhone(normalized: string): [string, string, string] {
  const last = normalized.slice(-4);
  const rest = normalized.slice(0, -4);
  // 서울(02)만 지역번호가 2자리, 나머지(010, 031, 070 …)는 3자리
  const headLength = rest.startsWith("02") ? 2 : 3;
  return [rest.slice(0, headLength), rest.slice(headLength), last];
}

/** "01012345678" → "010-1234-5678" */
export function formatPhone(normalized: string): string {
  return splitPhone(normalized).join("-");
}

/** "01012345678" → "010-****-5678" (가운데 자리를 가린다) */
export function maskPhone(normalized: string): string {
  const [head, middle, last] = splitPhone(normalized);
  return `${head}-${"*".repeat(middle.length)}-${last}`;
}
