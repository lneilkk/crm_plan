"use client";

import { type FormEvent, useState } from "react";
import { ApiRequestError } from "@/lib/auth/api-client";
import type { Chair } from "@/lib/domain/clinic";
import { isValidDateKey, isValidTime, kstDateKey, kstDateTime } from "@/lib/time/kst";
import { Button, Dialog, FieldError, Input, Label, Select } from "@/components/ui";
import type { BoardRow } from "@/server/board/rows";

export type RescheduleValues = { startAt: Date; chair: string; durationMin: number };

/**
 * [변경] — 새 날짜·시각(과 체어·소요시간)을 정해 예약변경(POST /api/appointments/[id]/reschedule).
 * 저장은 부모가 한다(onSubmit). 서버 오류(자리 겹침 등)는 이 창 안에 보여 준다.
 */
export function RescheduleDialog({
  row,
  chairs,
  pending,
  error,
  onSubmit,
  onClose,
}: {
  row: BoardRow;
  chairs: Chair[];
  pending: boolean;
  error: unknown;
  onSubmit: (values: RescheduleValues) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(kstDateKey(new Date(row.startAt)));
  const [time, setTime] = useState(row.time);
  const [chair, setChair] = useState(row.chair);
  const [duration, setDuration] = useState(String(row.durationMin));
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const minutes = Number(duration);
    if (!isValidDateKey(date) || !isValidTime(time) || Number(time.slice(3)) % 5 !== 0) {
      return setLocalError("날짜와 시각(5분 단위)을 확인하세요.");
    }
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480 || minutes % 5 !== 0) {
      return setLocalError("소요시간은 5분 단위로 5~480분 사이로 입력하세요.");
    }
    setLocalError(null);
    onSubmit({ startAt: kstDateTime(date, time), chair, durationMin: minutes });
  }

  const serverError = error
    ? error instanceof ApiRequestError
      ? error.message
      : "변경하지 못했습니다. 다시 시도하세요."
    : null;

  return (
    <Dialog open onClose={onClose} title={`예약 변경 · ${row.nameMasked} (${row.time})`}>
      <form onSubmit={submit} aria-label="예약 변경" className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="reschedule-date">날짜</Label>
            <Input id="reschedule-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="reschedule-time">시각</Label>
            <Input id="reschedule-time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="reschedule-chair">체어</Label>
            <Select id="reschedule-chair" value={chair} onChange={(e) => setChair(e.target.value)}>
              {!chairs.some((c) => c.code === chair) && <option value={chair}>{chair}</option>}
              {chairs.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="reschedule-duration">소요시간(분)</Label>
            <Input
              id="reschedule-duration"
              type="number"
              min={5}
              max={480}
              step={5}
              inputMode="numeric"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </div>
        </div>
        {(localError ?? serverError) && <FieldError>{localError ?? serverError}</FieldError>}
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            닫기
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "저장 중…" : "변경 저장"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
