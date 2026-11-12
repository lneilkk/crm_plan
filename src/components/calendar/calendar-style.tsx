"use client";

import { useQuery } from "@tanstack/react-query";
import { type CSSProperties, useMemo, useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/auth/api-client";
import {
  type CalendarLabel,
  DEFAULT_STATUS_STYLES,
  readableTextColor,
  representativeLabel,
  type StatusStyles,
} from "@/lib/calendar/colors";
import type { AppointmentStatus } from "@/lib/domain/appointment";
import { cn } from "@/components/ui";
import { isDimmedStatus } from "./types";

/**
 * 예약 캘린더 색 — F-2. 칸 색칠, 범례, 라벨 고르기, 칸 크기(F-3).
 * 색 값은 서버가 #RRGGBB로 검사한 값만 style에 넣는다.
 */

export type CalendarStyle = { labels: CalendarLabel[]; statusStyles: StatusStyles };

export const CALENDAR_STYLE_QUERY_KEY = ["calendar-style"] as const;

export function useCalendarStyle() {
  return useQuery({
    queryKey: CALENDAR_STYLE_QUERY_KEY,
    queryFn: () => apiFetch<CalendarStyle>("/api/settings/calendar-style"),
    staleTime: 60_000,
  });
}

/** 불러오기 전·실패 시에도 칸을 그릴 수 있는 기본값 */
export const FALLBACK_STYLE: CalendarStyle = { labels: [], statusStyles: DEFAULT_STATUS_STYLES };

/** 예약 칸 색: 대표 라벨 색(없으면 상태 색) 바탕, 왼쪽 굵은 띠는 상태 색 */
export function blockPaint(
  item: { status: AppointmentStatus; labelIds: readonly string[] },
  style: CalendarStyle,
): { style: CSSProperties; className: string } {
  const status = style.statusStyles[item.status];
  const label = representativeLabel(item.labelIds, style.labels);
  const background = label?.color ?? status.color;
  return {
    style: { backgroundColor: background, color: readableTextColor(background), borderLeftColor: status.color },
    className: cn("border-slate-900/20", isDimmedStatus(item.status) && "opacity-55"),
  };
}

/** 색 동그라미 + 이름 (범례·칩) */
export function ColorChip({ color, name, className }: { color: string; name: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)}>
      <span aria-hidden className="inline-block size-3.5 shrink-0 rounded-sm border border-black/20" style={{ backgroundColor: color }} />
      {name}
    </span>
  );
}

/** 상태 이름표 — 상태 색 바탕 */
export function StatusTag({ status, style }: { status: AppointmentStatus; style: CalendarStyle }) {
  const { name, color } = style.statusStyles[status];
  return (
    <span
      className="inline-block rounded px-1 text-xs font-semibold"
      style={{ backgroundColor: color, color: readableTextColor(color), outline: "1px solid rgb(255 255 255 / 0.6)" }}
    >
      {name}
    </span>
  );
}

/** 칸 안의 라벨 이름들(대표 라벨 포함, 순서대로) */
export function labelNames(labelIds: readonly string[], style: CalendarStyle): string[] {
  return style.labels.filter((label) => labelIds.includes(label.id)).map((label) => label.name);
}

/** 캘린더 위 범례: 상태(캘린더에 보이는 것만) + 숨기지 않은 라벨 */
const LEGEND_STATUSES: AppointmentStatus[] = ["BOOKED", "CONFIRMED", "ARRIVED", "IN_TREATMENT", "LEFT", "NO_SHOW", "CANCELED_SAME_DAY", "CANCELED_ADVANCE"];

export function CalendarLegend({ style }: { style: CalendarStyle }) {
  const labels = style.labels.filter((label) => label.isActive);
  return (
    <div aria-label="색 범례" className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-slate-800">
      {LEGEND_STATUSES.map((status) => (
        <ColorChip key={status} color={style.statusStyles[status].color} name={style.statusStyles[status].name} />
      ))}
      {labels.length > 0 && <span aria-hidden className="text-slate-300">|</span>}
      {labels.map((label) => (
        <ColorChip key={label.id} color={label.color} name={label.name} />
      ))}
    </div>
  );
}

/**
 * 라벨 고르기(여러 개). 숨긴 라벨은 이미 붙어 있을 때만 보이고 뺄 수만 있다.
 * 칸 색은 고른 라벨 중 순서가 가장 위인 라벨의 색이다.
 */
export function LabelPicker({
  style,
  value,
  onChange,
  disabled,
  idPrefix,
}: {
  style: CalendarStyle;
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const shown = style.labels.filter((label) => label.isActive || value.includes(label.id));
  if (shown.length === 0) return <p className="text-sm text-slate-500">만든 라벨이 없습니다. 관리자가 [편집]에서 만듭니다.</p>;
  return (
    <div role="group" aria-labelledby={`${idPrefix}-labels-title`} className="flex flex-wrap gap-1.5">
      {shown.map((label) => {
        const on = value.includes(label.id);
        const canToggle = !disabled && (on || label.isActive);
        return (
          <button
            key={label.id}
            type="button"
            aria-pressed={on}
            disabled={!canToggle}
            onClick={() => onChange(on ? value.filter((id) => id !== label.id) : [...value, label.id])}
            className={cn(
              "min-h-9 rounded-full border px-3 text-sm font-semibold disabled:cursor-not-allowed",
              on ? "border-transparent shadow-sm" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100",
            )}
            style={on ? { backgroundColor: label.color, color: readableTextColor(label.color) } : undefined}
          >
            {!on && <span aria-hidden className="mr-1.5 inline-block size-3 rounded-sm align-middle" style={{ backgroundColor: label.color }} />}
            {label.name}
            {!label.isActive && " (숨김)"}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 칸 크기 (F-3) — 브라우저마다 기억한다(직원 개인 화면 설정이라 서버에 두지 않는다).

export type ColumnWidth = "fit" | 90 | 120 | 160 | 200;
export type RowHeight = "fit" | "small" | "normal" | "large";
export type CalendarSize = { width: ColumnWidth; height: RowHeight };

export const COLUMN_WIDTH_OPTIONS: { value: ColumnWidth; label: string }[] = [
  { value: "fit", label: "화면 맞춤" },
  { value: 90, label: "90px" },
  { value: 120, label: "120px" },
  { value: 160, label: "160px" },
  { value: 200, label: "200px" },
];

export const ROW_HEIGHT_OPTIONS: { value: RowHeight; label: string }[] = [
  { value: "fit", label: "화면 맞춤" },
  { value: "small", label: "작게" },
  { value: "normal", label: "보통" },
  { value: "large", label: "크게" },
];

/** 30분 한 줄의 높이 = 분당 픽셀 × 30 */
const PX_PER_MIN: Record<Exclude<RowHeight, "fit">, number> = { small: 1.2, normal: 2, large: 3 };
const MIN_FIT_PX_PER_MIN = 0.9;

const SIZE_KEY = "crm_calendar_size";
const DEFAULT_SIZE: CalendarSize = { width: "fit", height: "normal" };

const SIZE_EVENT = "crm-calendar-size";

function parseSize(raw: string | null): CalendarSize {
  try {
    const parsed = JSON.parse(raw ?? "null") as Partial<CalendarSize> | null;
    const width = COLUMN_WIDTH_OPTIONS.find((o) => o.value === parsed?.width)?.value ?? DEFAULT_SIZE.width;
    const height = ROW_HEIGHT_OPTIONS.find((o) => o.value === parsed?.height)?.value ?? DEFAULT_SIZE.height;
    return { width, height };
  } catch {
    return DEFAULT_SIZE;
  }
}

/** 저장소를 못 쓰는 브라우저(사생활 보호 모드 등)에서는 이번 화면에서만 기억한다 */
let memorySize: string | null = null;

function readRawSize(): string | null {
  try {
    return window.localStorage.getItem(SIZE_KEY) ?? memorySize;
  } catch {
    return memorySize;
  }
}

function subscribeSize(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(SIZE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SIZE_EVENT, onChange);
  };
}

export function useCalendarSize(): [CalendarSize, (next: CalendarSize) => void] {
  const raw = useSyncExternalStore(subscribeSize, readRawSize, () => null);
  const size = useMemo(() => parseSize(raw), [raw]);
  const update = (next: CalendarSize) => {
    memorySize = JSON.stringify(next);
    try {
      window.localStorage.setItem(SIZE_KEY, memorySize);
    } catch {
      // 저장할 수 없으면 memorySize만 쓴다.
    }
    window.dispatchEvent(new Event(SIZE_EVENT));
  };
  return [size, update];
}

function subscribeResize(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

/** 창 높이 (세로 '화면 맞춤'용) */
export function useViewportHeight(): number {
  return useSyncExternalStore(subscribeResize, () => window.innerHeight, () => 900);
}

/** 세로 규격 → 분당 픽셀. '화면 맞춤'은 진료시간 전체가 창 안에 들어가게(너무 작아지지는 않게) */
export function pxPerMinFor(height: RowHeight, rangeMinutes: number, availablePx: number): number {
  if (height !== "fit") return PX_PER_MIN[height];
  if (rangeMinutes <= 0) return PX_PER_MIN.normal;
  return Math.max(MIN_FIT_PX_PER_MIN, Math.min(PX_PER_MIN.large, availablePx / rangeMinutes));
}

/** 가로 규격 → 열 너비 CSS(grid) */
export function columnTrack(width: ColumnWidth): string {
  return width === "fit" ? "minmax(110px, 1fr)" : `${width}px`;
}
