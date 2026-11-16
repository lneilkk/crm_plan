/**
 * 화면 표시용 마스킹 (기획서 10장: 이름·전화번호 기본 마스킹, 예: 홍*동, 010-****-1234).
 * 전화번호 마스킹은 src/lib/phone.ts의 maskPhone을 쓴다.
 */

/**
 * 이름 마스킹. 첫 글자와 마지막 글자만 남긴다.
 * "홍길동" → "홍*동", "남궁민수" → "남**수", "이산" → "이*", 한 글자 → "*"
 */
export function maskName(name: string): string {
  const chars = Array.from(name.trim());
  if (chars.length === 0) return "";
  if (chars.length === 1) return "*";
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${"*".repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}

/** 생년월일 마스킹. "1990-05-17" → "1990-**-**" (연도만 남긴다) */
export function maskBirthDate(birthDate: string): string {
  return `${birthDate.slice(0, 4)}-**-**`;
}
