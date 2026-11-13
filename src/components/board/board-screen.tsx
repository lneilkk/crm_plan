"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch, ApiRequestError, type Me, ME_QUERY_KEY } from "@/lib/auth/api-client";
import { APPOINTMENT_CHANNEL_LABEL, APPOINTMENT_STATUS_LABEL, type AppointmentStatus, type VisitReasonCode } from "@/lib/domain/appointment";
import type { ClinicSettings } from "@/lib/domain/clinic";
import { REFERRAL_SOURCE_LABEL } from "@/lib/domain/patient";
import { formatKstDateLabel, formatKstShortDate, formatKstTime, kstDateKey } from "@/lib/time/kst";
import { Badge, type BadgeTone, Button, cn, EmptyState, Input, Spinner, Toast, type ToastTone } from "@/components/ui";
import type { BoardResponse } from "@/server/board/query";
import type { BoardRow } from "@/server/board/rows";
import type { PatientListItem } from "@/server/patients/service";
import { ReasonDialog } from "./reason-dialog";
import { RescheduleDialog, type RescheduleValues } from "./reschedule-dialog";
import { allowsArea } from "@/lib/auth/screen-registry";

const POLL_MS = 10_000;
const UNDO_MS = 5_000;
export const BOARD_QUERY_KEY = ["board"] as const;
const STATUS_CHANGED_MESSAGE = "다른 PC에서 상태가 바뀌었습니다. 최신 상태로 다시 불러왔습니다.";

type ToastState = {
  id: number;
  message: string;
  tone: ToastTone;
  /** 5초 되돌리기: 되돌릴 예약과 지금(바뀐 뒤) 상태 */
  undo?: { appointmentId: string; expectedStatus: AppointmentStatus; nameMasked: string };
};

let toastSeq = 0;

type Picker = { row: BoardRow; to: "NO_SHOW" | "CANCELED_SAME_DAY" };

type StatusResult = { appointment: { status: AppointmentStatus }; isLate: boolean };

const STATUS_TONE: Partial<Record<AppointmentStatus, BadgeTone>> = {
  BOOKED: "info",
  CONFIRMED: "success",
  NO_SHOW: "danger",
  CANCELED_SAME_DAY: "muted",
  CANCELED_ADVANCE: "muted",
};

/**
 * 오늘의 내원 보드 — T5-3 (기획서 4-2).
 * - 상단 요약, 전화번호 뒷 4자리 빠른 검색, 시각순 목록, 행마다 [내원] [노쇼] [취소] [변경].
 * - [내원]은 한 번 누르면 저장되고 5초 동안 되돌리기를 보여 준다. 노쇼·당일취소는 사유를 고르는 순간 저장된다.
 * - 버튼·지각·미확인 강조는 서버가 서버 시각으로 계산해 보낸다(GET /api/board). 10초마다, 그리고 저장할 때마다 다시 읽는다.
 * - 다른 PC가 먼저 바꿨으면(409 STATUS_CHANGED) 다시 읽고 알린다.
 * - 의사(visit.write 없음)는 보기만 한다. 실제 차단은 API의 권한 검사다.
 */
export function BoardScreen() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: () => apiFetch<Me>("/api/auth/me"), staleTime: 60_000 });
  const board = useQuery({
    queryKey: BOARD_QUERY_KEY,
    queryFn: () => apiFetch<BoardResponse>("/api/board"),
    refetchInterval: POLL_MS,
  });
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiFetch<ClinicSettings>("/api/settings"),
    staleTime: 60_000,
  });

  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [rescheduling, setRescheduling] = useState<BoardRow | null>(null);

  const last4 = /^\d{4}$/.test(search) ? search : null;
  // 번호 뒷 4자리만(kind=phoneLast4 — 숫자 차트번호와 섞지 않는다), 보드에 띄운 날 예약한 고객 중에서만 찾는다.
  // 날짜로 좁히면 서버가 건수 상한을 두지 않으므로 오늘 고객이 상한 때문에 빠지지 않는다.
  const boardDate = board.data?.date ?? null;
  const searchResult = useQuery({
    queryKey: ["patients", "board-search", boardDate, last4],
    queryFn: () =>
      apiFetch<{ items: PatientListItem[] }>(
        `/api/patients?${new URLSearchParams({ q: last4!, kind: "phoneLast4", appointmentDate: boardDate! })}`,
      ),
    enabled: last4 !== null && boardDate !== null,
    staleTime: 0,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: BOARD_QUERY_KEY });
  const show = (next: Omit<ToastState, "id">) => setToast({ ...next, id: ++toastSeq });

  function showError(error: unknown) {
    if (error instanceof ApiRequestError && error.status === 401) return; // providers가 로그인 화면으로 보낸다
    if (error instanceof ApiRequestError && error.code === "STATUS_CHANGED") {
      show({ message: STATUS_CHANGED_MESSAGE, tone: "danger" });
    } else {
      show({ message: error instanceof ApiRequestError ? error.message : "저장하지 못했습니다. 다시 시도하세요.", tone: "danger" });
    }
  }

  const changeStatus = useMutation({
    mutationFn: (v: { row: BoardRow; to: AppointmentStatus; reasonCode?: VisitReasonCode }) =>
      apiFetch<StatusResult>(`/api/appointments/${v.row.id}/status`, {
        method: "POST",
        body: { to: v.to, reasonCode: v.reasonCode ?? null, expectedStatus: v.row.status },
      }),
    onSuccess: (result, v) => {
      const label = result.isLate ? "지각내원" : APPOINTMENT_STATUS_LABEL[result.appointment.status];
      show({
        message: `${v.row.nameMasked} ${label} 처리됨`,
        tone: "success",
        undo: { appointmentId: v.row.id, expectedStatus: result.appointment.status, nameMasked: v.row.nameMasked },
      });
    },
    onError: showError,
    onSettled: refresh,
  });

  const revert = useMutation({
    mutationFn: (v: { appointmentId: string; expectedStatus: AppointmentStatus; nameMasked: string }) =>
      apiFetch<StatusResult>(`/api/appointments/${v.appointmentId}/revert`, {
        method: "POST",
        body: { expectedStatus: v.expectedStatus },
      }),
    onSuccess: (result, v) =>
      show({ message: `${v.nameMasked} ${APPOINTMENT_STATUS_LABEL[result.appointment.status]}(으)로 되돌렸습니다`, tone: "info" }),
    onError: showError,
    onSettled: refresh,
  });

  const reschedule = useMutation({
    mutationFn: (v: { row: BoardRow; values: RescheduleValues }) =>
      apiFetch(`/api/appointments/${v.row.id}/reschedule`, {
        method: "POST",
        body: {
          startAt: v.values.startAt.toISOString(),
          chair: v.values.chair,
          durationMin: v.values.durationMin,
          expectedStatus: v.row.status,
        },
      }),
    onSuccess: (_result, v) => {
      setRescheduling(null);
      const when = `${formatKstShortDate(kstDateKey(v.values.startAt))} ${formatKstTime(v.values.startAt)}`;
      show({ message: `${v.row.nameMasked} 예약을 ${when}(으)로 변경했습니다`, tone: "success" });
    },
    onError: (error) => {
      // 상태가 바뀐 경우는 창을 닫고 알린다. 자리 겹침 등은 창 안에 보여 준다(reschedule.error).
      if (error instanceof ApiRequestError && error.code === "STATUS_CHANGED") {
        setRescheduling(null);
        showError(error);
      }
    },
    onSettled: refresh,
  });

  if (me.isPending || board.isPending) return <Spinner showLabel label="내원 보드를 불러오는 중" />;
  if (me.isError || board.isError) {
    return (
      <EmptyState
        title="내원 보드를 불러오지 못했습니다"
        description={(me.error ?? board.error)?.message}
        action={<Button onClick={() => (me.isError ? me.refetch() : board.refetch())}>다시 시도</Button>}
      />
    );
  }

  const canVisit = allowsArea(me.data.permissions, "board.visitActions");
  const canReschedule = allowsArea(me.data.permissions, "board.reschedule");
  const busy = changeStatus.isPending || revert.isPending || reschedule.isPending;
  const data = board.data;
  const matched = last4 && searchResult.data ? new Set(searchResult.data.items.map((p) => p.id)) : null;
  const rows = matched ? data.items.filter((row) => matched.has(row.patientId)) : data.items;
  const redCount = data.items.filter((row) => row.overdue === "red").length;

  function onCancel(row: BoardRow) {
    if (row.cancelTo === "CANCELED_SAME_DAY") setPicker({ row, to: "CANCELED_SAME_DAY" });
    else changeStatus.mutate({ row, to: "CANCELED_ADVANCE" });
  }

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">
          내원 보드 <span className="text-lg font-semibold text-slate-600">{formatKstDateLabel(data.date)}</span>
        </h1>
        <SearchBox value={search} onChange={setSearch} />
      </div>

      <SummaryBar summary={data.summary} />

      {redCount > 0 && (
        <p role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-lg font-semibold text-red-800">
          노쇼 유예시간이 지났는데 결과가 입력되지 않은 예약이 {redCount}건 있습니다.
        </p>
      )}

      {last4 && (
        <p className="text-base text-slate-700" aria-live="polite">
          {searchResult.isPending
            ? "검색 중…"
            : searchResult.isError
              ? searchResult.error.message
              : `뒷자리 ${last4} 고객의 오늘 예약 ${rows.length}건`}
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState title={last4 ? "검색한 번호의 오늘 예약이 없습니다" : "오늘 예약이 없습니다"} />
      ) : (
        <BoardTable
          rows={rows}
          showActions={canVisit || canReschedule}
          canVisit={canVisit}
          canReschedule={canReschedule}
          busy={busy}
          onArrive={(row) => changeStatus.mutate({ row, to: "ARRIVED" })}
          onNoShow={(row) => setPicker({ row, to: "NO_SHOW" })}
          onCancel={onCancel}
          onReschedule={(row) => {
            reschedule.reset();
            setRescheduling(row);
          }}
          onRevert={(row) => revert.mutate({ appointmentId: row.id, expectedStatus: row.status, nameMasked: row.nameMasked })}
        />
      )}

      {picker && (
        <ReasonDialog
          title={`${picker.to === "NO_SHOW" ? "노쇼" : "당일취소"} 사유 · ${picker.row.nameMasked} (${picker.row.time})`}
          onClose={() => setPicker(null)}
          onPick={(reasonCode) => {
            changeStatus.mutate({ row: picker.row, to: picker.to, reasonCode });
            setPicker(null);
          }}
        />
      )}

      {rescheduling && (
        <RescheduleDialog
          row={rescheduling}
          chairs={settings.data?.chairs ?? []}
          pending={reschedule.isPending}
          error={reschedule.error}
          onSubmit={(values) => reschedule.mutate({ row: rescheduling, values })}
          onClose={() => setRescheduling(null)}
        />
      )}

      {toast && (
        <Toast
          key={toast.id}
          message={toast.message}
          tone={toast.tone}
          durationMs={UNDO_MS}
          action={toast.undo ? { label: "되돌리기", onClick: () => revert.mutate(toast.undo!) } : undefined}
          onClose={() => setToast((current) => (current?.id === toast.id ? null : current))}
        />
      )}
    </div>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="board-search" className="text-base font-semibold text-slate-700">
        전화 뒷 4자리
      </label>
      <Input
        id="board-search"
        type="search"
        inputMode="numeric"
        maxLength={4}
        autoComplete="off"
        placeholder="1234"
        className="w-32 text-lg"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
      />
      {value && (
        <Button variant="ghost" onClick={() => onChange("")}>
          검색 지우기
        </Button>
      )}
    </div>
  );
}

function SummaryBar({ summary }: { summary: BoardResponse["summary"] }) {
  const items: { label: string; value: number; className?: string }[] = [
    { label: "내원", value: summary.arrived, className: "text-green-800" },
    { label: "대기", value: summary.waiting, className: "text-blue-800" },
    { label: "노쇼", value: summary.noShow, className: "text-red-700" },
    { label: "미확인", value: summary.unconfirmed, className: summary.unconfirmed > 0 ? "text-orange-700" : undefined },
  ];
  return (
    <section
      aria-label="오늘 요약"
      className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-xl"
    >
      <span className="font-bold">오늘 예약 {summary.total}건</span>
      {items.map((item) => (
        <span key={item.label} className="flex items-baseline gap-2">
          <span className="text-slate-400" aria-hidden>
            ·
          </span>
          <span className="text-slate-600">{item.label}</span>
          <span className={cn("font-bold tabular-nums", item.className)}>{item.value}</span>
        </span>
      ))}
      <span className="ml-auto text-base text-slate-600">
        지각 {summary.late} · 당일취소 {summary.sameDayCanceled}
      </span>
    </section>
  );
}

function BoardTable({
  rows,
  showActions,
  canVisit,
  canReschedule,
  busy,
  onArrive,
  onNoShow,
  onCancel,
  onReschedule,
  onRevert,
}: {
  rows: BoardRow[];
  showActions: boolean;
  canVisit: boolean;
  canReschedule: boolean;
  busy: boolean;
  onArrive: (row: BoardRow) => void;
  onNoShow: (row: BoardRow) => void;
  onCancel: (row: BoardRow) => void;
  onReschedule: (row: BoardRow) => void;
  onRevert: (row: BoardRow) => void;
}) {
  return (
    <div className="w-full overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full border-collapse text-left text-base">
        <thead className="bg-slate-50 text-sm text-slate-600">
          <tr>
            {["시간", "고객명", "신환/구환", "예약 항목", "담당자", "유입경로", "상태"].map((label) => (
              <th key={label} scope="col" className="px-3 py-2 font-semibold whitespace-nowrap">
                {label}
              </th>
            ))}
            {showActions && (
              <th scope="col" className="px-3 py-2 font-semibold">
                처리
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <BoardTableRow
              key={row.id}
              row={row}
              showActions={showActions}
              canVisit={canVisit}
              canReschedule={canReschedule}
              busy={busy}
              onArrive={onArrive}
              onNoShow={onNoShow}
              onCancel={onCancel}
              onReschedule={onReschedule}
              onRevert={onRevert}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const OVERDUE_ROW: Record<BoardRow["overdue"], string> = {
  none: "",
  orange: "bg-orange-50 shadow-[inset_6px_0_0_0_var(--color-orange-500)]",
  red: "bg-red-50 shadow-[inset_6px_0_0_0_var(--color-red-600)]",
};

function BoardTableRow({
  row,
  showActions,
  canVisit,
  canReschedule,
  busy,
  onArrive,
  onNoShow,
  onCancel,
  onReschedule,
  onRevert,
}: {
  row: BoardRow;
  showActions: boolean;
  canVisit: boolean;
  canReschedule: boolean;
  busy: boolean;
  onArrive: (row: BoardRow) => void;
  onNoShow: (row: BoardRow) => void;
  onCancel: (row: BoardRow) => void;
  onReschedule: (row: BoardRow) => void;
  onRevert: (row: BoardRow) => void;
}) {
  const has = (action: BoardRow["actions"][number]) => row.actions.includes(action);
  const pending = row.status === "BOOKED" || row.status === "CONFIRMED";
  const dimmed = row.status === "CANCELED_SAME_DAY" || row.status === "CANCELED_ADVANCE";
  const noShowFrom = row.noShowAllowedAt ? formatKstTime(new Date(row.noShowAllowedAt)) : null;
  const staff = [row.doctorName, row.counselorName].filter(Boolean).join(" · ") || "-";
  const overdueLabel = row.overdue === "red" ? " · 유예시간 지남" : row.overdue === "orange" ? " · 예약 시각 지남" : "";

  return (
    <tr
      data-testid="board-row"
      data-appointment-id={row.id}
      aria-label={`${row.time} ${row.nameMasked} ${row.statusLabel}${overdueLabel}`}
      className={cn(OVERDUE_ROW[row.overdue], dimmed && "text-slate-400")}
    >
      <td className="px-3 py-3 text-xl font-bold tabular-nums">{row.time}</td>
      <td className="px-3 py-3 text-lg font-semibold">{row.nameMasked}</td>
      <td className="px-3 py-3">
        {row.isNew ? <Badge tone="warning">신환</Badge> : <Badge tone="neutral">구환</Badge>}
      </td>
      <td className="px-3 py-3">{row.treatmentItem}</td>
      <td className="px-3 py-3">{staff}</td>
      <td className="px-3 py-3">
        <div className="flex flex-wrap gap-1">
          {row.referralSource && <Badge tone="info">{REFERRAL_SOURCE_LABEL[row.referralSource]}</Badge>}
          <Badge tone="muted">{APPOINTMENT_CHANNEL_LABEL[row.channel]}</Badge>
        </div>
      </td>
      <td className="px-3 py-3">
        <Badge tone={row.isLate ? "warning" : (STATUS_TONE[row.status] ?? "neutral")} className="text-base">
          {row.statusLabel}
        </Badge>
        {row.isLate && row.status !== "ARRIVED" && <span className="ml-1 text-sm text-amber-800">(지각)</span>}
        {row.overdue === "orange" && <div className="mt-1 text-sm font-semibold text-orange-700">미확인</div>}
        {row.overdue === "red" && <div className="mt-1 text-sm font-semibold text-red-700">미확인 · 노쇼 가능</div>}
      </td>
      {showActions && (
        <td className="px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            {canVisit && (pending || has("ARRIVE")) && (
              <Button size="lg" className="min-w-20" disabled={busy || !has("ARRIVE")} onClick={() => onArrive(row)}>
                내원
              </Button>
            )}
            {canVisit && pending && (
              <span title={noShowFrom ? `${noShowFrom}부터 가능` : undefined}>
                <Button
                  size="lg"
                  variant="danger"
                  className="min-w-20 flex-col gap-0 leading-tight"
                  aria-label="노쇼"
                  aria-describedby={noShowFrom ? `noshow-${row.id}` : undefined}
                  disabled={busy || !has("NO_SHOW")}
                  onClick={() => onNoShow(row)}
                >
                  노쇼
                  {noShowFrom && (
                    <span id={`noshow-${row.id}`} className="text-xs font-normal">
                      {noShowFrom}부터 가능
                    </span>
                  )}
                </Button>
              </span>
            )}
            {canVisit && pending && (
              <Button size="lg" variant="secondary" className="min-w-20" disabled={busy || !has("CANCEL")} onClick={() => onCancel(row)}>
                취소
              </Button>
            )}
            {canReschedule && pending && (
              <Button
                size="lg"
                variant="secondary"
                className="min-w-20"
                disabled={busy || !has("RESCHEDULE")}
                onClick={() => onReschedule(row)}
              >
                변경
              </Button>
            )}
            {canVisit && has("REVERT") && (
              <Button variant="ghost" className="border border-slate-300" disabled={busy} onClick={() => onRevert(row)}>
                되돌리기
              </Button>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}
