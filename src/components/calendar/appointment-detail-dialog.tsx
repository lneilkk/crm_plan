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
import type { Chair, ClinicSettings } from "@/lib/domain/clinic";
import {
  formatKstDateLabel,
  formatKstShortDate,
  formatKstTime,
  isValidTime,
  kstDateKey,
  kstDateTime,
  kstMinutesOfDay,
} from "@/lib/time/kst";
import { amountAfterDiscount, isPremiumItem } from "@/lib/domain/treatment";
import type { Permission } from "@/lib/auth/permissions";
import { SurgerySection } from "./surgery-section";
import { Badge, Button, Dialog, FieldError, Input, Label, Select, Spinner } from "@/components/ui";
import { AppointmentEditSection } from "./appointment-edit-section";
import { type CalendarStyle, ColorChip, LabelPicker } from "./calendar-style";
import { type AppointmentDetail, type CalendarAppointment, type DoctorOption, STATUS_TONE } from "./types";
import { allowsArea } from "@/lib/auth/screen-registry";

function dateTimeLabel(iso: string): string {
  const instant = new Date(iso);
  return `${formatKstShortDate(kstDateKey(instant))} ${formatKstTime(instant)}`;
}

/**
 * 예약 상세 — 블록을 누르면 연다(GET /api/appointments/[id]). 상태 이력을 한국어로 보여 준다.
 * 오늘 이후의 대기 상태 예약은 '시간 이동' 입력으로도 같은 날 안에서 옮길 수 있다(끌기 대신 키보드로).
 * 지난 날의 예약은 내원 보드에서 정리하고, 날짜를 바꾸는 것은 예약변경이다(서버도 거부한다).
 */
export function AppointmentDetailDialog({
  appointment,
  chairs,
  settings,
  doctors,
  canWrite,
  permissions,
  style,
  today,
  onClose,
  onMoved,
  onLabelsSaved,
}: {
  appointment: CalendarAppointment;
  chairs: Chair[];
  /** 예약 항목·구분·단가 (F-5·F-6) */
  settings: ClinicSettings;
  doctors: DoctorOption[];
  canWrite: boolean;
  /** 보는 직원의 역할 — 수술 기록 권한(F-11) */
  permissions: readonly Permission[];
  /** 색 라벨 (F-2) */
  style: CalendarStyle;
  /** 오늘(한국 시간) */
  today: string;
  onClose: () => void;
  onMoved: () => Promise<unknown>;
  /** 라벨·예약을 저장했을 때 (알림 문구) */
  onLabelsSaved: (message: string) => void;
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
          permissions={permissions}
          style={style}
          settings={settings}
          doctors={doctors}
          today={today}
          onEdited={() => {
            onLabelsSaved("예약을 저장했습니다.");
            void detail.refetch();
          }}
          onMoved={async () => {
            await Promise.all([onMoved(), detail.refetch()]);
          }}
          onLabelsSaved={(message?: string) => {
            onLabelsSaved(message ?? "라벨을 저장했습니다.");
            void detail.refetch();
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
  permissions,
  style,
  settings,
  doctors,
  today,
  onEdited,
  onMoved,
  onLabelsSaved,
}: {
  data: AppointmentDetail;
  chairName: (code: string) => string;
  chairs: Chair[];
  canWrite: boolean;
  permissions: readonly Permission[];
  style: CalendarStyle;
  settings: ClinicSettings;
  doctors: DoctorOption[];
  today: string;
  onEdited: () => void;
  onMoved: () => Promise<void>;
  onLabelsSaved: (message?: string) => void;
}) {
  const start = new Date(data.startAt);
  // 보기가 기본이고, [고치기]를 눌렀을 때만 수정 양식·라벨 고르기가 보인다 (F-12)
  const [editing, setEditing] = useState(false);
  // 금액은 금액 권한이 있을 때만 응답에 온다 (S-3)
  const price = data.listPrice !== undefined && data.discountRate !== undefined ? { list: data.listPrice, discount: data.discountRate } : null;
  const labelNamesShown = style.labels.filter((label) => data.labelIds.includes(label.id));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xl font-bold">{data.patientNameMasked}</span>
        {data.isNewPatient ? <Badge tone="warning">신환</Badge> : <Badge tone="neutral">구환</Badge>}
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
        {price && (
          <Row label="금액">
            {price.list.toLocaleString("ko-KR")}원{price.discount > 0 && ` · 할인 ${price.discount}%`} →{" "}
            <strong>{amountAfterDiscount(price.list, price.discount).toLocaleString("ko-KR")}원</strong>
          </Row>
        )}
        <Row label="색 라벨">
          {labelNamesShown.length === 0 ? (
            "-"
          ) : (
            <span className="flex flex-wrap gap-3">
              {labelNamesShown.map((label) => (
                <ColorChip key={label.id} color={label.color} name={label.name} />
              ))}
            </span>
          )}
        </Row>
        <Row label="메모">
          <span className="whitespace-pre-wrap">{data.memo ?? "-"}</span>
        </Row>
        <Row label="등록">{dateTimeLabel(data.createdAt)}</Row>
      </dl>

      {canWrite && !editing && (
        <div>
          <Button variant="secondary" onClick={() => setEditing(true)}>
            고치기
          </Button>
        </div>
      )}
      {canWrite && editing && (
        <div className="flex flex-col gap-3 rounded-lg border-2 border-blue-200 p-3">
          <AppointmentEditSection
            key={`${data.treatmentItem}|${data.chair}|${data.doctorId}|${data.counselorId}|${data.discountRate}|${data.memo}`}
            data={data}
            settings={settings}
            doctors={doctors}
            canWrite={canWrite}
            canPrice={allowsArea(permissions, "appointment.price")}
            today={today}
            onSaved={() => {
              setEditing(false);
              onEdited();
            }}
          />
          <LabelSection key={data.labelIds.join(",")} appointmentId={data.id} saved={data.labelIds} style={style} canWrite={canWrite} onSaved={onLabelsSaved} />
          <div>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              고치기 닫기
            </Button>
          </div>
        </div>
      )}

      {(isPremiumItem(settings.treatmentItemMeta, data.treatmentItem) || data.participants.length > 0) && (
        <SurgerySection key={data.participants.map((p) => p.staffId).join(",")} data={data} permissions={permissions} onSaved={(message) => onLabelsSaved(message)} />
      )}

      {canWrite && isPendingStatus(data.status) && kstDateKey(start) >= today && (
        <MoveForm data={data} chairs={chairs} onMoved={onMoved} />
      )}

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

/** 끌기 대신 쓰는 시간 이동 입력 (PATCH /api/appointments/[id]/move). 날짜는 그대로 — 다른 날로는 예약변경으로 옮긴다. */
function MoveForm({ data, chairs, onMoved }: { data: AppointmentDetail; chairs: Chair[]; onMoved: () => Promise<void> }) {
  const start = new Date(data.startAt);
  const date = kstDateKey(start);
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
    if (!isValidTime(time) || Number(time.slice(3)) % 5 !== 0) {
      return setLocalError("시각(5분 단위)을 확인하세요.");
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
          <Input id="move-date" type="date" value={date} readOnly aria-describedby="move-date-note" />
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
      <p id="move-date-note" className="mt-2 text-sm text-slate-500">
        날짜를 바꾸려면 내원 보드의 [변경]으로 예약변경을 하세요.
      </p>
      {localError && <FieldError>{localError}</FieldError>}
      {serverError && <FieldError>{serverError}</FieldError>}
    </form>
  );
}

/** 색 라벨 (F-2) — 예약을 쓸 수 있는 직원은 고르고 저장, 의사는 보기만 */
function LabelSection({
  appointmentId,
  saved,
  style,
  canWrite,
  onSaved,
}: {
  appointmentId: string;
  saved: string[];
  style: CalendarStyle;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<string[]>(saved);
  const changed = value.length !== saved.length || value.some((id) => !saved.includes(id));
  const save = useMutation({
    mutationFn: () => apiFetch(`/api/appointments/${appointmentId}/labels`, { method: "PUT", body: { labelIds: value } }),
    // 응답(labelIds)을 넘기지 않는다 — onSaved의 인자는 알림 문구다
    onSuccess: () => onSaved(),
  });

  if (!canWrite) {
    const names = style.labels.filter((label) => saved.includes(label.id));
    return (
      <div>
        <p className="mb-1 text-base font-semibold text-slate-800">색 라벨</p>
        {names.length === 0 ? (
          <p className="text-base text-slate-500">없음</p>
        ) : (
          <div className="flex flex-wrap gap-3 text-base">
            {names.map((label) => (
              <ColorChip key={label.id} color={label.color} name={label.name} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p id="detail-labels-title" className="text-base font-semibold text-slate-800">
        색 라벨 <span className="text-sm font-normal text-slate-500">(칸 색은 편집 탭 순서상 가장 위 라벨)</span>
      </p>
      <LabelPicker style={style} value={value} onChange={setValue} idPrefix="detail" disabled={save.isPending} />
      <div className="flex items-center gap-3">
        <Button variant="secondary" disabled={!changed || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "저장 중…" : "라벨 저장"}
        </Button>
        {save.isError && (
          <FieldError>{save.error instanceof ApiRequestError ? save.error.message : "저장하지 못했습니다."}</FieldError>
        )}
      </div>
    </div>
  );
}
