"use client";

import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  blockBox,
  type CalendarColumn,
  type ColumnMode,
  columnIndexAt,
  columnKeyOf,
  draggedStart,
  layoutLanes,
  minutesSinceDayStart,
  minutesToTime,
  ROW_MINUTES,
  rowStarts,
} from "@/lib/calendar/layout";
import { APPOINTMENT_STATUS_LABEL, isPendingStatus } from "@/lib/domain/appointment";
import type { DateKey } from "@/lib/time/kst";
import { Badge, cn } from "@/components/ui";
import { blockColor, type CalendarAppointment, isDimmedStatus, STATUS_TONE } from "./types";

/** 분당 픽셀 — 30분 한 줄이 60px */
export const PX_PER_MIN = 2;
/** 끌어 옮길 때 세로 맞춤 단위(분). 5분 단위는 상세의 '시간 이동' 입력으로 한다. */
export const DRAG_SNAP_MIN = 10;
/** 손이 살짝 떨린 것은 클릭으로 본다 */
const DRAG_THRESHOLD_PX = 5;
const MIN_BLOCK_PX = 26;

export type MoveTarget = { start: number; chair?: string };

type Placed = CalendarAppointment & { start: number; end: number; columnKey: string };

type DragState = {
  id: string;
  pointerId: number;
  /** 포인터를 붙잡은 블록 — Esc로 취소할 때 놓아 준다 */
  element: HTMLElement;
  originX: number;
  originY: number;
  originStart: number;
  originColumn: number;
  duration: number;
  moved: boolean;
  start: number;
  column: number;
};

/**
 * 일 보기 — 30분 줄 × 열(체어 또는 의사). 빈 칸은 예약 등록 버튼, 예약 블록은 상세 보기 버튼이다.
 * 대기 상태(예약확정·확인완료) 예약은 끌어서 시간을(체어별 보기에서는 체어도) 옮길 수 있다.
 */
export function DayView({
  date,
  range,
  columns,
  mode,
  appointments,
  canWrite,
  pendingMove,
  onCellClick,
  onOpen,
  onMove,
}: {
  date: DateKey;
  range: { start: number; end: number };
  columns: CalendarColumn[];
  mode: ColumnMode;
  appointments: CalendarAppointment[];
  canWrite: boolean;
  /** 저장 중인 이동 — 응답이 올 때까지 새 자리에 보인다 */
  pendingMove: ({ id: string } & MoveTarget) | null;
  onCellClick: (column: CalendarColumn, start: number) => void;
  onOpen: (appointment: CalendarAppointment) => void;
  onMove: (appointment: CalendarAppointment, target: MoveTarget) => void;
}) {
  const columnsRef = useRef<HTMLDivElement>(null);
  const justDragged = useRef(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const rows = rowStarts(range);
  const heightPx = (range.end - range.start) * PX_PER_MIN;

  const placed = useMemo<Placed[]>(
    () =>
      appointments.map((appointment) => {
        const moved = pendingMove?.id === appointment.id ? pendingMove : null;
        const start = moved?.start ?? minutesSinceDayStart(date, appointment.startAt);
        const chair = moved?.chair ?? appointment.chair;
        return {
          ...appointment,
          chair,
          start,
          end: start + appointment.durationMin,
          columnKey: columnKeyOf(mode, { chair, doctorId: appointment.doctorId }),
        };
      }),
    [appointments, pendingMove, date, mode],
  );

  const byColumn = useMemo(() => {
    const map = new Map<string, { items: Placed[]; lanes: ReturnType<typeof layoutLanes> }>();
    for (const column of columns) {
      const items = placed.filter((item) => item.columnKey === column.key);
      map.set(column.key, { items, lanes: layoutLanes(items) });
    }
    return map;
  }, [columns, placed]);

  function canDrag(item: Placed) {
    return canWrite && isPendingStatus(item.status) && pendingMove === null;
  }

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>, item: Placed, columnIndex: number) {
    justDragged.current = false;
    if (!canDrag(item) || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      id: item.id,
      pointerId: event.pointerId,
      element: event.currentTarget,
      originX: event.clientX,
      originY: event.clientY,
      originStart: item.start,
      originColumn: columnIndex,
      duration: item.durationMin,
      moved: false,
      start: item.start,
      column: columnIndex,
    });
  }

  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.originX;
    const dy = event.clientY - drag.originY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    const start = draggedStart(drag.originStart, dy, PX_PER_MIN, DRAG_SNAP_MIN, drag.duration, range);
    let column = drag.originColumn;
    // 의사별 보기에서는 시간만 옮긴다(이동 API가 의사를 바꾸지 않는다).
    if (mode === "chair" && columnsRef.current) {
      const rect = columnsRef.current.getBoundingClientRect();
      column = columnIndexAt(event.clientX - rect.left, rect.width, columns.length);
    }
    setDrag({ ...drag, moved: true, start, column });
  }

  function onPointerUp(event: ReactPointerEvent<HTMLButtonElement>, item: Placed) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    setDrag(null);
    if (!drag.moved) return; // 클릭 → onClick이 상세를 연다
    justDragged.current = true;
    const target = columns[drag.column];
    const chairChanged = mode === "chair" && target.chair !== undefined && target.chair !== item.chair;
    if (drag.start === drag.originStart && !chairChanged) return;
    onMove(item, { start: drag.start, ...(chairChanged ? { chair: target.chair } : {}) });
  }

  // 끄는 중 Esc → 옮기지 않고 제자리로. 뒤따르는 click이 상세를 열지 않게 막는다.
  useEffect(() => {
    if (!drag) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || !drag) return;
      event.preventDefault();
      justDragged.current = true;
      // 손을 뗀 뒤의 click만 막고, 그 뒤 키보드(Enter)로 여는 것은 막지 않는다.
      document.addEventListener("pointerup", () => setTimeout(() => (justDragged.current = false)), { once: true });
      if (drag.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
      setDrag(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drag]);

  const dragItem = drag?.moved ? placed.find((item) => item.id === drag.id) : undefined;

  return (
    <div className="max-h-[calc(100vh-190px)] min-h-80 overflow-auto rounded-xl border border-slate-300 bg-white">
      {/* 열 제목 — 스크롤해도 위에 붙어 있다 */}
      <div className="sticky top-0 z-30 flex border-b border-slate-300 bg-slate-50">
        <div className="w-16 shrink-0" />
        <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(140px, 1fr))` }}>
          {columns.map((column) => (
            <div key={column.key} className="border-l border-slate-300 px-2 py-2 text-center text-base font-bold text-slate-800">
              {column.label}
              {column.chair && column.label !== column.chair && (
                <span className="ml-1 text-sm font-normal text-slate-500">{column.chair}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex">
        {/* 시각 눈금 */}
        <div className="relative w-16 shrink-0" style={{ height: heightPx }}>
          {rows.map((rowStart) => (
            <div
              key={rowStart}
              className="absolute right-2 pt-1 text-sm font-semibold tabular-nums text-slate-600"
              style={{ top: (rowStart - range.start) * PX_PER_MIN }}
            >
              {minutesToTime(rowStart)}
            </div>
          ))}
        </div>

        <div
          ref={columnsRef}
          className="relative grid flex-1"
          style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(140px, 1fr))`, height: heightPx }}
        >
          {columns.map((column, columnIndex) => {
            const entry = byColumn.get(column.key);
            const cellName = column.chair ?? column.label;
            return (
              <div key={column.key} className="relative border-l border-slate-300">
                {rows.map((rowStart) => {
                  const time = minutesToTime(rowStart);
                  const style = { height: ROW_MINUTES * PX_PER_MIN };
                  const line = rowStart % 60 === 0 ? "border-slate-300" : "border-dashed border-slate-200";
                  return canWrite ? (
                    <button
                      key={rowStart}
                      type="button"
                      aria-label={`${cellName} ${date} ${time} 예약 등록`}
                      title={`${time} 예약 등록`}
                      onClick={() => onCellClick(column, rowStart)}
                      className={cn(
                        "group block w-full border-t text-left hover:bg-blue-50 focus-visible:bg-blue-50",
                        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-500",
                        line,
                      )}
                      style={style}
                    >
                      <span className="hidden px-2 text-sm text-blue-700 group-hover:inline group-focus-visible:inline">
                        + {time}
                      </span>
                    </button>
                  ) : (
                    <div key={rowStart} className={cn("border-t", line)} style={style} />
                  );
                })}

                {entry?.items.map((item) => {
                  const box = blockBox(item, range, PX_PER_MIN, MIN_BLOCK_PX);
                  const lane = entry.lanes.get(item.id) ?? { lane: 0, lanes: 1 };
                  const draggable = canDrag(item);
                  const isDragging = drag?.moved && drag.id === item.id;
                  const isSaving = pendingMove?.id === item.id;
                  const time = minutesToTime(item.start);
                  const status = APPOINTMENT_STATUS_LABEL[item.status];
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-label={`${time} ${item.patientNameMasked} ${item.treatmentItem} ${status} 예약`}
                      title={
                        draggable
                          ? "눌러서 상세 보기, 끌어서 시간 이동"
                          : canWrite && !isPendingStatus(item.status)
                            ? `${status} 상태의 예약은 옮길 수 없습니다 (눌러서 상세 보기)`
                            : "눌러서 상세 보기"
                      }
                      onClick={() => {
                        if (justDragged.current) {
                          justDragged.current = false;
                          return;
                        }
                        onOpen(item);
                      }}
                      onPointerDown={(event) => onPointerDown(event, item, columnIndex)}
                      onPointerMove={onPointerMove}
                      onPointerUp={(event) => onPointerUp(event, item)}
                      onPointerCancel={() => setDrag(null)}
                      onLostPointerCapture={() => setDrag(null)}
                      className={cn(
                        "absolute z-10 flex flex-col overflow-hidden rounded-md border border-l-4 px-1.5 py-0.5 text-left text-sm leading-tight shadow-sm",
                        "focus-visible:z-20 focus-visible:outline-3 focus-visible:outline-blue-500",
                        blockColor(item.status),
                        draggable ? "cursor-grab touch-none" : "cursor-pointer",
                        isDragging && "opacity-40",
                        isSaving && "animate-pulse",
                      )}
                      style={{
                        top: box.top,
                        height: box.height - 2,
                        left: `calc(${(lane.lane / lane.lanes) * 100}% + 2px)`,
                        width: `calc(${100 / lane.lanes}% - 4px)`,
                      }}
                    >
                      <span className="flex items-center gap-1">
                        <span className="font-bold tabular-nums">{time}</span>
                        <span className={cn("truncate font-semibold", isDimmedStatus(item.status) && "line-through")}>
                          {item.patientNameMasked}
                        </span>
                        {item.isNewPatient && (
                          <Badge tone="warning" className="px-1 py-0 text-xs">
                            신규
                          </Badge>
                        )}
                      </span>
                      <span className="truncate">{item.treatmentItem}</span>
                      <span>
                        <Badge tone={STATUS_TONE[item.status]} className="px-1 py-0 text-xs">
                          {status}
                        </Badge>
                      </span>
                    </button>
                  );
                })}

                {dragItem && drag && drag.column === columnIndex && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0.5 z-20 rounded-md border-2 border-dashed border-blue-600 bg-blue-100/80 px-1.5 py-0.5 text-sm font-bold text-blue-900"
                    style={{ top: (drag.start - range.start) * PX_PER_MIN, height: drag.duration * PX_PER_MIN - 2 }}
                  >
                    {minutesToTime(drag.start)}~{minutesToTime(drag.start + drag.duration)} {dragItem.patientNameMasked}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
