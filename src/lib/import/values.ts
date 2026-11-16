import type { AppointmentStatus } from "@/lib/domain/appointment";
import type { Gender, ReferralSource } from "@/lib/domain/patient";
import { type DateKey, isValidDateKey } from "@/lib/time/kst";

/**
 * 기존 CRM 엑셀 가져오기의 값 해석 — F-7(Task.md M9 일부). 화면(미리보기)과 서버(최종 검사)가 같이 쓴다.
 * 결과는 코드·정규화한 값이다. 해석하지 못하면 null — 그 행은 오류로 보고하고 넣지 않는다.
 */

/**
 * 엑셀 칸 값을 글자로. 엑셀 날짜에는 시간대가 없어 read-excel-file은 '벽시계 시각'을 UTC 성분으로 준다
 * (예: 엑셀 2026-11-01 10:30 → 2026-11-01T10:30:00Z). 그 성분을 그대로 쓰고, 한국 시간으로 해석하는 것은 서버가 한다.
 */
export function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return value.toISOString().slice(0, 16).replace("T", " ");
  }
  return String(value).trim();
}

/** "2026-11-01", "2026.11.01", "2026/11/1", "20261101", "2026. 11. 1." (뒤에 시각이 붙어도 됨) → "2026-11-01" */
export function parseDateKey(text: string): DateKey | null {
  const t = text.trim();
  const match = /^(\d{4})\s*[-./]?\s*(\d{1,2})\s*[-./]?\s*(\d{1,2})\.?(?:[\sT].*)?$/.exec(t);
  if (!match) return null;
  const key = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  return isValidDateKey(key) ? key : null;
}

/** "9:05", "14:30", "오후 2:30", "2026-11-01 14:30" → "HH:mm" */
export function parseTime(text: string): string | null {
  const t = text.trim();
  const match = /(오전|오후|AM|PM)?\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i.exec(t);
  if (!match) return null;
  let hour = Number(match[2]);
  const minute = Number(match[3]);
  const meridiem = (match[1] ?? match[4] ?? "").toUpperCase();
  if (meridiem === "오후" || meridiem === "PM") hour = hour === 12 ? 12 : hour + 12;
  if ((meridiem === "오전" || meridiem === "AM") && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parseGender(text: string): Gender | null {
  const t = text.trim().toLowerCase();
  if (["남", "남자", "남성", "m", "male"].includes(t)) return "MALE";
  if (["여", "여자", "여성", "f", "female"].includes(t)) return "FEMALE";
  return null;
}

/** 유입경로 글자 → 코드. 빈 값은 null, 알아보지 못한 값은 기타 */
export function parseReferral(text: string): ReferralSource | null {
  const t = text.trim();
  if (!t) return null;
  if (/소개|지인|추천/.test(t)) return "REFERRAL";
  if (/네이버|카카오|플랫폼|앱|강남언니|모두닥/.test(t)) return "PLATFORM";
  if (/홈페이지|웹|인터넷|블로그|검색/.test(t)) return "WEBSITE";
  if (/전화/.test(t)) return "PHONE";
  return "OTHER";
}

/** 예약 상태 글자 → 상태. 빈 값은 예약확정. 알아보지 못하면 null(오류) */
export function parseStatus(text: string): AppointmentStatus | null {
  const t = text.replace(/\s+/g, "");
  if (!t || /^(예약|예약확정|접수)$/.test(t)) return "BOOKED";
  if (/^(확인|확인완료|확정)$/.test(t)) return "CONFIRMED";
  if (/당일취소/.test(t)) return "CANCELED_SAME_DAY";
  if (/취소/.test(t)) return "CANCELED_ADVANCE";
  if (/노쇼|미내원|부도/.test(t)) return "NO_SHOW";
  if (/변경/.test(t)) return "RESCHEDULED";
  if (/수납/.test(t)) return "PAID";
  if (/완료|귀가/.test(t)) return "LEFT";
  if (/진료중/.test(t)) return "IN_TREATMENT";
  if (/내원|방문/.test(t)) return "ARRIVED";
  return null;
}

/** 동의 여부: Y·예·동의·O·1·true만 동의로 본다(나머지는 동의 미확인) */
export function parseConsent(text: string): boolean {
  return /^(y|yes|예|네|동의|o|1|true)$/i.test(text.trim());
}

/** 주민등록번호 열 이름 — 가져오기 화면에서 고를 수 없게 뺀다(절대 규칙 3) */
export function isResidentNumberHeader(header: string): boolean {
  return /주민|rrn|jumin|resident/i.test(header.replace(/\s+/g, ""));
}
