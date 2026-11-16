"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./button";
import { cn } from "./cn";

export type ToastTone = "info" | "success" | "danger";

const TONE: Record<ToastTone, string> = {
  info: "bg-slate-900 text-white",
  success: "bg-green-800 text-white",
  danger: "bg-red-800 text-white",
};

/**
 * 화면 아래쪽 알림 줄. durationMs가 지나면 onClose를 부른다.
 * action을 주면 버튼과 남은 초를 함께 보여 준다 — 내원 보드의 5초 "되돌리기":
 *
 *   {undo && (
 *     <Toast key={undo.id} message="내원으로 바꿨습니다" action={{ label: "되돌리기", onClick: revert }}
 *            durationMs={5000} onClose={() => setUndo(null)} />
 *   )}
 *
 * 같은 자리에 새 알림을 띄울 때는 key를 바꿔 타이머를 새로 시작한다.
 * action을 누르면 onClick 뒤에 onClose도 부른다.
 */
export function Toast({
  message,
  tone = "info",
  action,
  durationMs = 5000,
  onClose,
}: {
  message: string;
  tone?: ToastTone;
  action?: { label: string; onClick: () => void };
  durationMs?: number;
  onClose: () => void;
}) {
  const [remainingMs, setRemainingMs] = useState(durationMs);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const deadline = Date.now() + durationMs;
    const interval = setInterval(() => {
      const left = deadline - Date.now();
      if (left <= 0) {
        clearInterval(interval);
        onCloseRef.current();
      } else {
        setRemainingMs(left);
      }
    }, 200);
    return () => clearInterval(interval);
  }, [durationMs]);

  const seconds = Math.ceil(remainingMs / 1000);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        className={cn("pointer-events-auto flex min-h-14 w-full max-w-xl items-center gap-4 rounded-xl px-4 py-2 shadow-lg", TONE[tone])}
      >
        <p className="flex-1 text-base font-medium">{message}</p>
        {action && (
          <Button
            variant="secondary"
            size="md"
            onClick={() => {
              action.onClick();
              onCloseRef.current();
            }}
          >
            {action.label} <span className="tabular-nums text-slate-500">{seconds}초</span>
          </Button>
        )}
        {!action && (
          <button type="button" onClick={() => onCloseRef.current()} className="min-h-11 px-2 text-white/80 hover:text-white" aria-label="알림 닫기">
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
