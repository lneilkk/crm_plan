/**
 * 한국 시간(KST) 유틸.
 *
 * 병원의 '하루', '당일', 요일은 항상 한국 시간 기준이다.
 * 한국은 UTC+9 고정이고 서머타임이 없으므로 오프셋 계산만으로 정확하다.
 * 서버·브라우저의 로컬 시간대와 무관하게 같은 결과를 내도록 UTC 계열 함수만 쓴다.
 *
 * - 시각(instant)은 Date로, DB에는 timestamptz(UTC)로 저장한다.
 * - 달력 날짜는 "YYYY-MM-DD" 문자열(DateKey)로 다룬다.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const KST_OFFSET_MS = 9 * 60 * MINUTE_MS;

/** 한국 시간 기준 달력 날짜 "YYYY-MM-DD" */
export type DateKey = string;
/** 한국 시간 기준 달 "YYYY-MM" */
export type MonthKey = string;

export const KOREAN_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 한국 벽시계 값을 UTC 필드에 담은 Date (내부 계산용) */
function toKstWallClock(instant: Date): Date {
  return new Date(instant.getTime() + KST_OFFSET_MS);
}

function parseDateKey(key: DateKey): { y: number; m: number; d: number } {
  const match = DATE_KEY_RE.exec(key);
  if (!match) throw new RangeError("날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)");
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw new RangeError("존재하지 않는 날짜입니다");
  }
  return { y, m, d };
}

function toDateKey(utcMidnight: Date): DateKey {
  return `${utcMidnight.getUTCFullYear()}-${pad2(utcMidnight.getUTCMonth() + 1)}-${pad2(utcMidnight.getUTCDate())}`;
}

/** "YYYY-MM-DD" 형식이고 실제로 존재하는 날짜인지 */
export function isValidDateKey(value: string): boolean {
  try {
    parseDateKey(value);
    return true;
  } catch {
    return false;
  }
}

/** "HH:mm" (00:00~23:59) 형식인지 */
export function isValidTime(value: string): boolean {
  return TIME_RE.test(value);
}

/** 어떤 시각이 한국 시간으로 며칠인지 */
export function kstDateKey(instant: Date): DateKey {
  return toDateKey(toKstWallClock(instant));
}

/** 그 날짜의 한국 시간 00:00 */
export function kstDayStart(key: DateKey): Date {
  const { y, m, d } = parseDateKey(key);
  return new Date(Date.UTC(y, m - 1, d) - KST_OFFSET_MS);
}

/** 그 날짜 하루의 범위 [start, end) */
export function kstDayRange(key: DateKey): { start: Date; end: Date } {
  const start = kstDayStart(key);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/** 날짜 + "HH:mm"(한국 시간) → 시각 */
export function kstDateTime(key: DateKey, time: string): Date {
  const match = TIME_RE.exec(time);
  if (!match) throw new RangeError("시각 형식이 올바르지 않습니다 (HH:mm)");
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return new Date(kstDayStart(key).getTime() + minutes * MINUTE_MS);
}

/** 한국 시간으로 자정부터 몇 분 지났는지 (0~1439) */
export function kstMinutesOfDay(instant: Date): number {
  const wall = toKstWallClock(instant);
  return wall.getUTCHours() * 60 + wall.getUTCMinutes();
}

/** 한국 시간 "HH:mm" */
export function formatKstTime(instant: Date): string {
  const minutes = kstMinutesOfDay(instant);
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

/** 요일: 0=일 … 6=토 */
export function kstWeekday(key: DateKey): number {
  const { y, m, d } = parseDateKey(key);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 날짜에 일수를 더한다 (음수 가능) */
export function addDays(key: DateKey, days: number): DateKey {
  const { y, m, d } = parseDateKey(key);
  return toDateKey(new Date(Date.UTC(y, m - 1, d + days)));
}

/** from에서 to까지 며칠인지 (to가 뒤면 양수) */
export function diffDays(from: DateKey, to: DateKey): number {
  const a = parseDateKey(from);
  const b = parseDateKey(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY_MS);
}

/** 그 날짜가 속한 주의 월요일 (주는 월요일에 시작) */
export function kstWeekStart(key: DateKey): DateKey {
  return addDays(key, -((kstWeekday(key) + 6) % 7));
}

/** 그 날짜가 속한 달 "YYYY-MM" */
export function kstMonthKey(key: DateKey): MonthKey {
  parseDateKey(key);
  return key.slice(0, 7);
}

/** 두 시각이 한국 시간으로 같은 날인지 */
export function isSameKstDay(a: Date, b: Date): boolean {
  return kstDateKey(a) === kstDateKey(b);
}

/** "2026년 11월 11일 (수)" */
export function formatKstDateLabel(key: DateKey): string {
  const { y, m, d } = parseDateKey(key);
  return `${y}년 ${m}월 ${d}일 (${KOREAN_WEEKDAYS[kstWeekday(key)]})`;
}

/** "11/11 (수)" */
export function formatKstShortDate(key: DateKey): string {
  const { m, d } = parseDateKey(key);
  return `${m}/${d} (${KOREAN_WEEKDAYS[kstWeekday(key)]})`;
}
