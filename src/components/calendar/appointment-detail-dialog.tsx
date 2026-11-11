"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { type FormEvent, type ReactNode, useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/auth/api-client";
import { minutesToTime } from "@/lib/calendar/layout";
import {
  APPOINTMENT_CHANNEL_LABEL,
  APPOINTMENT_STATUS_LABEL,
  isPendingStatus,
  VISIT_REASON_LABEL,
} from "@/lib/domain/appointment";
import type { Chair } from "@/lib/domain/clinic";
import {
  formatKstDateLabel,
  formatKstShortDate,
  formatKstTime,
  isValidDateKey,
  isValidTime,
  kstDateKey,
  kstDateTime,
  kstMinutesOfDay,
} from "@/lib/time/kst";
import { Badge, Button, Dialog, FieldError, Input, Label, Select, Spinner } from "@/components/ui";
import { type AppointmentDetail, type CalendarAppointment, STATUS_TONE } from "./types";

function dateTimeLabel(iso: string): string {
  const instant = new Date(iso);
  return `${formatKstShortDate(kstDateKey(instant))} ${formatKstTime(instant)}`;
}

/**
 * 예약 상세 — 블록을 누르면 연다(GET /api/appointments/[id]). 상태 이력을 한국어로 보여 준다.
 * 대기 상태 예약은 '시간 이동' 입력으로도 옮길 수 있다(끌기 대신 키보드로).
 */
export function AppointmentDetailDialog({
  appointment,
  chairs,
  canWrite,
  onClose,
  onMoved,
}: {
  appointment: CalendarAppointment;
  chairs: Chair[];
  canWrite: boolean;
  onClose: () => void;
  onMoved: () => Promise<unknown>;
}) {
  const detail = useQuery({
    queryKey: ["appointment", appointment.id],
    queryFn: () => apiFetch<{ appointment: AppointmentDetail }>(`/api/appointments/${appointment.id}`),
    staleTime: 0,
  });
  const chairName = (code: string) => chairs.find((c) => c.code === code)?.name ?? code;

  return (
    <Dialog
      open
      onClose={onClose}
      title="예약 상세"
      className="max-w-2xl"
      footer={
        <Button variant="secondary" onClick={onClose}>
          닫기
        </Button>
      }
    >
      {detail.isPending ? (
        <Spinner showLabel />
      ) : detail.isError ? (
        <div className="flex flex-col items-start gap-2">
          <FieldError>{detail.error.message}</FieldError>
          <Button onClick={() => detail.refetch()}>다시 시도</Button>
        </div>
      ) : (
        <DetailBody
          data={detail.data.appointment}
          chairName={chairName}
          chairs={chairs}
          canWrite={canWrite}
          onMoved={async () => {
            await Promise.all([onMoved(), detail.refetch()]);
          }}
        />
      )}
    </Dialog>
  );
}

function DetailBody({
  data,
  chairName,
  chairs,
  canWrite,
  onMoved,
}: {
  data: AppointmentDetail;
  chairName: (code: string) => string;
  chairs: Chair[];
  canWrite: boolean;
  onMoved: () => Promise<void>;
}) {
  const start = new Date(data.startAt);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xl font-bold">{data.patientNameMasked}</span>
        {data.isNewPatient && <Badge tone="warning">신규</Badge>}
        <Badge tone={STATUS_TONE[data.status]}>{APPOINTMENT_STATUS_LABEL[data.status]}</Badge>
        <Link href={`/patients/${data.patientId}`} className="ml-auto text-base font-semibold text-blue-700 underline">
          고객 상세 보기
        </Link>
      </div>

      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-base">
        <Row label="일시">
          {formatKstDateLabel(kstDateKey(start))} {formatKstTime(start)}~{formatKstTime(new Date(data.endAt))} ({data.durationMin}분)
        </Row>
        <Row label="체어">
          {chairName(data.chair)} ({data.chair})
        </Row>
        <Row label="의사">{data.doctorName ?? "미지정"}</Row>
        <Row label="상담">{data.counselorName ?? "-"}</Row>
        <Row label="예약 항목">{data.treatmentItem}</Row>
        <Row label="채널">{APPOINTMENT_CHANNEL_LABEL[data.channel]}</Row>
        {data.arrivedAt && <Row label="내원 시각">{dateTimeLabel(data.arrivedAt)}</Row>}
        {data.originalAppointmentId && <Row label="변경 전 예약">있음 (예약변경으로 만든 예약)</Row>}
        <Row label="메모">
          <span className="whitespace-pre-wrap">{data.memo ?? "-"}</span>
        </Row>
        <Row label="등록">{dateTimeLabel(data.createdAt)}</Row>
      </dl>

      {canWrite && isPendingStatus(data.status) && <MoveForm data={data} chairs={chairs} onMoved={onMoved} />}

      <section>
        <h3 className="mb-2 text-lg font-bold">상태 이력</h3>
        {data.history.length === 0 ? (
          <p className="text-slate-600">이력이 없습니다.</p>
        ) : (
          <ol aria-label="상태 이력" className="flex flex-col gap-1">
            {data.history.map((entry, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-base">
                <span className="tabular-nums text-slate-600">{dateTimeLabel(entry.createdAt)}</span>
                <span>
                  {entry.fromStatus ? APPOINTMENT_STATUS_LABEL[entry.fromStatus] : "신규 등록"} →{" "}
                  <strong>{APPOINTMENT_STATUS_LABEL[entry.toStatus]}</strong>
                </span>
                {entry.reasonCode && <Badge tone="muted">사유: {VISIT_REASON_LABEL[entry.reasonCode]}</Badge>}
                <span className="ml-auto text-sm text-slate-600">{entry.staffName}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="font-semibold text-slate-600">{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

/** 끌기 대신 쓰는 시간 이동 입력 (PATCH /api/appointments/[id]/move) */
function MoveForm({ data, chairs, onMoved }: { data: AppointmentDetail; chairs: Chair[]; onMoved: () => Promise<void> }) {
  const start = new Date(data.startAt);
  const [date, setDate] = useState(kstDateKey(start));
  const [time, setTime] = useState(minutesToTime(kstMinutesOfDay(start)));
  const [chair, setChair] = useState(data.chair);
  const [duration, setDuration] = useState(String(data.durationMin));
  const [localError, setLocalError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const move = useMutation({
    mutationFn: () =>
      apiFetch(`/api/appointments/${data.id}/move`, {
        method: "PATCH",
        body: { startAt: kstDateTime(date, time).toISOString(), chair, durationMin: Number(duration) },
      }),
    onSuccess: async () => {
      await onMoved();
      setDone(true);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setDone(false);
    const minutes = Number(duration);
    if (!isValidDateKey(date) || !isValidTime(time) || Number(time.slice(3)) % 5 !== 0) {
      return setLocalError("날짜와 시각(5분 단위)을 확인하세요.");
    }
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480 || minutes % 5 !== 0) {
      return setLocalError("소요시간은 5분 단위로 5~480분 사이로 입력하세요.");
    }
    setLocalError(null);
    move.mutate();
  }

  const serverError = move.error
    ? move.error instanceof ApiRequestError
      ? move.error.message
      : "옮기지 못했습니다. 다시 시도하세요."
    : null;

  return (
    <form onSubmit={submit} aria-label="시간 이동" className="rounded-lg border border-slate-200 p-3">
      <h3 className="mb-2 text-lg font-bold">시간 이동</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div>
          <Label htmlFor="move-date">날짜</Label>
          <Input id="move-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="move-time">시각</Label>
          <Input id="move-time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="move-chair">체어</Label>
          <Select id="move-chair" value={chair} onChange={(e) => setChair(e.target.value)}>
            {!chairs.some((c) => c.code === chair) && <option value={chair}>{chair}</option>}
            {chairs.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.code})
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="move-duration">소요시간(분)</Label>
          <Input
            id="move-duration"
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
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={move.isPending}>
          {move.isPending ? "옮기는 중…" : "이동 저장"}
        </Button>
        {done && !move.isPending && (
          <span role="status" className="font-semibold text-green-800">
            옮겼습니다.
          </span>
        )}
      </div>
      {localError && <FieldError>{localError}</FieldError>}
      {serverError && <FieldError>{serverError}</FieldError>}
    </form>
  );
}
