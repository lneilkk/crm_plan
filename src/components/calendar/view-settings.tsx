"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ColumnMode } from "@/lib/calendar/layout";
import { Button, cn, Label, Select } from "@/components/ui";
import { type CalendarSize, COLUMN_WIDTH_OPTIONS, ROW_HEIGHT_OPTIONS } from "./calendar-style";

/**
 * 캘린더 [보기 설정] — 확장 계획 S-5. 화면 표시 옵션을 버튼 하나에 모은다.
 * - 열 기준(체어별 = 과별 묶음 / 의사별), 가로규격·세로규격(F-3, 이 브라우저에 기억).
 * - 일 보기에서만 쓰는 옵션이라 주 보기에서는 버튼을 그리지 않는다(캘린더 화면이 정한다).
 * - 색 규칙은 옵션이 아니라 범례에 한 번만 적는다(CalendarLegend).
 * 바깥을 누르거나 Esc를 누르면 닫힌다. 고르면 바로 적용된다(저장 버튼 없음).
 */
export function ViewSettings({
  mode,
  onModeChange,
  size,
  onSizeChange,
}: {
  mode: ColumnMode;
  onModeChange: (mode: ColumnMode) => void;
  size: CalendarSize;
  onSizeChange: (size: CalendarSize) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const modeLabel = mode === "chair" ? "체어별" : "의사별";
  return (
    <div ref={root} className="relative">
      <Button ref={button} variant="secondary" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
        보기 설정 <span className="font-normal text-slate-600">· {modeLabel}</span> <span aria-hidden>▾</span>
      </Button>
      {open && (
        <div
          id={panelId}
          role="group"
          aria-label="보기 설정"
          className="absolute right-0 z-35 mt-2 flex w-80 flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-lg"
        >
          <div>
            <p className="mb-1.5 text-base font-semibold text-slate-800">열 기준</p>
            <div role="group" aria-label="열 기준" className="flex overflow-hidden rounded-lg border border-slate-300">
              {(
                [
                  { value: "chair", label: "체어별" },
                  { value: "doctor", label: "의사별" },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={mode === option.value}
                  onClick={() => onModeChange(option.value)}
                  className={cn(
                    "min-h-11 flex-1 px-3 text-base font-semibold",
                    mode === option.value ? "bg-blue-700 text-white" : "bg-white text-slate-700 hover:bg-slate-100",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-sm text-slate-500">체어별은 과(체어 묶음)마다 나눠 보여 줍니다.</p>
          </div>
          <div className="grid grid-cols-[5.5rem_1fr] items-center gap-x-3 gap-y-2">
            <Label htmlFor={`${panelId}-width`} className="mb-0">
              가로규격
            </Label>
            <Select
              id={`${panelId}-width`}
              value={String(size.width)}
              onChange={(e) => {
                const found = COLUMN_WIDTH_OPTIONS.find((o) => String(o.value) === e.target.value);
                if (found) onSizeChange({ ...size, width: found.value });
              }}
            >
              {COLUMN_WIDTH_OPTIONS.map((o) => (
                <option key={String(o.value)} value={String(o.value)}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Label htmlFor={`${panelId}-height`} className="mb-0">
              세로규격
            </Label>
            <Select
              id={`${panelId}-height`}
              value={size.height}
              onChange={(e) => {
                const found = ROW_HEIGHT_OPTIONS.find((o) => o.value === e.target.value);
                if (found) onSizeChange({ ...size, height: found.value });
              }}
            >
              {ROW_HEIGHT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <p className="text-sm text-slate-500">칸 크기는 이 컴퓨터(브라우저)에 기억됩니다.</p>
        </div>
      )}
    </div>
  );
}
