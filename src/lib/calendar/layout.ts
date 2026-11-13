/**
 * 예약 캘린더 배치 계산 — T4-2. 화면(src/components/calendar)이 쓰는 순수 함수.
 *
 * - 시각은 모두 "그 날짜 한국 시간 00:00부터 몇 분"(분 단위 정수)으로 다룬다.
 * - 세로 위치는 격자 시작 시각(보통 진료 시작)부터의 분 × 분당 픽셀이다.
 * - 같은 열에서 시간이 겹치는 예약은 나란히(lane) 놓는다.
 */
import type { BusinessHours, Chair } from "@/lib/domain/clinic";
import { type DateKey, kstDayStart, kstWeekday } from "@/lib/time/kst";

/** 캘린더 한 줄(빈 칸 하나)의 길이(분) */
export const ROW_MINUTES = 30;

const MINUTE_MS = 60_000;

/** "HH:mm" → 자정부터 몇 분 */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** 자정부터 몇 분 → "HH:mm" */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 시각(ISO 문자열 또는 Date)이 그 날짜 한국 시간 00:00부터 몇 분인지. 다른 날이면 음수이거나 1440 이상이다. */
export function minutesSinceDayStart(date: DateKey, instant: string | Date): number {
  const time = typeof instant === "string" ? new Date(instant).getTime() : instant.getTime();
  return Math.round((time - kstDayStart(date).getTime()) / MINUTE_MS);
}

/** 그 날짜의 진료시간(분). 휴진이면 null */
export function businessHoursOf(hours: BusinessHours, date: DateKey): { open: number; close: number } | null {
  const day = hours[String(kstWeekday(date)) as keyof BusinessHours];
  if (!day) return null;
  return { open: timeToMinutes(day.open), close: timeToMinutes(day.close) };
}

/**
 * 하루 격자의 범위(분). 진료시간을 기본으로 하되, 진료시간 밖에 걸친 예약이 있으면 그 예약이 보이도록 넓힌다.
 * 양끝은 ROW_MINUTES 단위로 맞춘다(시작은 내림, 끝은 올림). 진료시간도 예약도 없으면 null.
 */
export function gridRange(
  hours: { open: number; close: number } | null,
  items: ReadonlyArray<{ start: number; end: number }>,
): { start: number; end: number } | null {
  let start = hours?.open ?? Infinity;
  let end = hours?.close ?? -Infinity;
  for (const item of items) {
    start = Math.min(start, item.start);
    end = Math.max(end, item.end);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  start = Math.max(0, Math.floor(start / ROW_MINUTES) * ROW_MINUTES);
  end = Math.min(24 * 60, Math.ceil(end / ROW_MINUTES) * ROW_MINUTES);
  return { start, end };
}

/** 격자의 줄 시작 시각들 (ROW_MINUTES 간격) */
export function rowStarts(range: { start: number; end: number }): number[] {
  const rows: number[] = [];
  for (let m = range.start; m < range.end; m += ROW_MINUTES) rows.push(m);
  return rows;
}

/** 예약 블록의 세로 위치(px). 격자 밖으로 나간 부분은 잘라 낸다. 짧아도 최소 높이를 지킨다. */
export function blockBox(
  item: { start: number; end: number },
  range: { start: number; end: number },
  pxPerMin: number,
  minHeightPx = 0,
): { top: number; height: number } {
  const start = Math.max(item.start, range.start);
  const end = Math.min(item.end, range.end);
  return { top: (start - range.start) * pxPerMin, height: Math.max((end - start) * pxPerMin, minHeightPx) };
}

/**
 * 같은 열의 예약을 겹침에 따라 나란히 놓는다.
 * 서로 (이어져) 겹치는 예약 묶음마다 필요한 칸 수(lanes)를 정하고, 각 예약은 비어 있는 가장 왼쪽 칸(lane)에 놓는다.
 * 끝 시각과 다음 시작 시각이 같으면 겹치지 않는 것으로 본다.
 */
export function layoutLanes<T extends { id: string; start: number; end: number }>(
  items: readonly T[],
): Map<string, { lane: number; lanes: number }> {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end || a.id.localeCompare(b.id));
  const result = new Map<string, { lane: number; lanes: number }>();
  let cluster: { id: string; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    for (const entry of cluster) result.set(entry.id, { lane: entry.lane, lanes: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };

  for (const item of sorted) {
    if (item.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.end);
    } else {
      laneEnds[lane] = item.end;
    }
    cluster.push({ id: item.id, lane });
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();
  return result;
}

/** 가장 가까운 step 단위로 맞춘다 (예: 10분 단위) */
export function snapMinutes(minutes: number, step: number): number {
  return Math.round(minutes / step) * step;
}

/**
 * 끌어 옮길 때 새 시작 시각. 움직인 픽셀을 분으로 바꿔 step 단위로 맞추고, 예약이 격자 안에 들어오게 제한한다.
 * 원래 시작이 step 단위가 아니어도(예: 10:05) 결과는 step 단위 시각이 된다.
 */
export function draggedStart(
  originalStart: number,
  deltaPx: number,
  pxPerMin: number,
  step: number,
  durationMin: number,
  range: { start: number; end: number },
): number {
  const snapped = snapMinutes(originalStart + deltaPx / pxPerMin, step);
  const latest = Math.floor((range.end - durationMin) / step) * step;
  const earliest = Math.ceil(range.start / step) * step;
  return Math.min(Math.max(snapped, earliest), Math.max(latest, earliest));
}

/** 가로 위치(px, 열 영역 왼쪽 기준)가 몇 번째 열인지. 영역 밖이면 양끝 열로 맞춘다. */
export function columnIndexAt(offsetX: number, totalWidth: number, columnCount: number): number {
  if (columnCount <= 0 || totalWidth <= 0) return 0;
  const index = Math.floor((offsetX / totalWidth) * columnCount);
  return Math.min(Math.max(index, 0), columnCount - 1);
}

// ── 열 ─────────────────────────────────────────────────────────────

export type ColumnMode = "chair" | "doctor";

/** 의사 미지정 열의 키 */
export const UNASSIGNED_COLUMN = "__unassigned__";

export type CalendarColumn = {
  key: string;
  label: string;
  /** 체어별 보기에서 체어 코드 (빈 칸 클릭 시 미리 채움) */
  chair?: string;
  /** 의사별 보기에서 의사 id (미지정 열은 null) */
  doctorId?: string | null;
};

/** 예약이 어느 열에 들어가는지 */
export function columnKeyOf(mode: ColumnMode, item: { chair: string; doctorId: string | null }): string {
  if (mode === "chair") return item.chair;
  return item.doctorId ?? UNASSIGNED_COLUMN;
}

/**
 * 열 목록. 체어별은 설정의 체어 순서, 의사별은 의사 목록 + "미지정".
 * 설정에서 빠진 체어나 목록에 없는 의사(퇴사 등)의 예약이 있으면 그 열을 뒤에 덧붙여 예약이 사라지지 않게 한다.
 */
export function buildColumns(
  mode: ColumnMode,
  chairs: readonly Chair[],
  doctors: ReadonlyArray<{ id: string; name: string }>,
  items: ReadonlyArray<{ chair: string; doctorId: string | null; doctorName?: string | null }>,
): CalendarColumn[] {
  const columns: CalendarColumn[] =
    mode === "chair"
      ? chairs.map((chair) => ({ key: chair.code, label: chair.name, chair: chair.code }))
      : [
          ...doctors.map((doctor) => ({ key: doctor.id, label: doctor.name, doctorId: doctor.id })),
          { key: UNASSIGNED_COLUMN, label: "미지정", doctorId: null },
        ];
  const known = new Set(columns.map((column) => column.key));
  for (const item of items) {
    const key = columnKeyOf(mode, item);
    if (known.has(key)) continue;
    known.add(key);
    columns.push(
      mode === "chair"
        ? { key, label: item.chair, chair: item.chair }
        : { key, label: item.doctorName ?? "알 수 없는 의사", doctorId: item.doctorId },
    );
  }
  return columns;
}
