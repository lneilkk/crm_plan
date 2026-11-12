"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch, ApiRequestError, type Me, ME_QUERY_KEY } from "@/lib/auth/api-client";
import { can } from "@/lib/auth/permissions";
import {
  buildColumns,
  businessHoursOf,
  type CalendarColumn,
  type ColumnMode,
  gridRange,
  minutesSinceDayStart,
  minutesToTime,
} from "@/lib/calendar/layout";
import type { ClinicSettings } from "@/lib/domain/clinic";
import {
  addDays,
  type DateKey,
  formatKstDateLabel,
  formatKstShortDate,
  isValidDateKey,
  kstDateKey,
  kstDayStart,
  kstWeekStart,
} from "@/lib/time/kst";
import { Button, cn, EmptyState, Input, Label, Select, Spinner, Toast, type ToastTone } from "@/components/ui";
import { AppointmentDetailDialog } from "./appointment-detail-dialog";
import { BookingDialog, type BookingPrefill } from "./booking-dialog";
import {
  CalendarLegend,
  type CalendarSize,
  type CalendarStyle,
  COLUMN_WIDTH_OPTIONS,
  FALLBACK_STYLE,
  pxPerMinFor,
  ROW_HEIGHT_OPTIONS,
  useCalendarSize,
  useCalendarStyle,
  useViewportHeight,
} from "./calendar-style";
import { CalendarStyleEditor } from "./calendar-style-editor";
import { DayView, type MoveTarget } from "./day-view";
import { APPOINTMENTS_QUERY_KEY, type CalendarAppointment, type DoctorOption } from "./types";
import { WeekView } from "./week-view";

type ViewMode = "day" | "week";

const POLL_MS = 30_000;

/**
 * 예약 캘린더 — T4-2. 일·주 보기, 체어별·의사별 열.
 * 빈 칸을 눌러 예약을 등록하고, 대기 상태 예약은 끌어서 옮긴다. 30초마다 새로 읽는다.
 * 의사(DOCTOR)는 보기만 한다(appointment.write 없음). 실제 차단은 API의 권한 검사다.
 */
export function CalendarScreen() {
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: () => apiFetch<Me>("/api/auth/me"), staleTime: 60_000 });
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiFetch<ClinicSettings>("/api/settings"),
    staleTime: 60_000,
  });
  const doctors = useQuery({
    queryKey: ["staff", "DOCTOR"],
    queryFn: () => apiFetch<{ staff: DoctorOption[] }>("/api/staff?role=DOCTOR"),
    staleTime: 60_000,
  });
  // 색 설정을 못 읽어도 캘린더는 기본 색으로 보여 준다.
  const calendarStyle = useCalendarStyle();

  if (me.isPending || settings.isPending || doctors.isPending) return <Spinner showLabel />;
  const failed = [me, settings, doctors].find((q) => q.isError)?.error;
  if (failed || !me.data || !settings.data || !doctors.data) {
    return (
      <EmptyState
        title={failed?.message ?? "불러오지 못했습니다"}
        action={
          <Button
            onClick={() => {
              void me.refetch();
              void settings.refetch();
              void doctors.refetch();
            }}
          >
            다시 시도
          </Button>
        }
      />
    );
  }
  return (
    <Calendar
      settings={settings.data}
      doctors={doctors.data.staff}
      canWrite={can(me.data.role, "appointment.write")}
      canEditStyle={can(me.data.role, "settings.write")}
      style={calendarStyle.data ?? FALLBACK_STYLE}
      styleReady={calendarStyle.isSuccess}
    />
  );
}

function Calendar({
  settings,
  doctors,
  canWrite,
  canEditStyle,
  style,
  styleReady,
}: {
  settings: ClinicSettings;
  doctors: DoctorOption[];
  canWrite: boolean;
  /** [편집] 탭 — 관리자만 (F-2) */
  canEditStyle: boolean;
  style: CalendarStyle;
  styleReady: boolean;
}) {
  const [tab, setTab] = useState<"calendar" | "edit">("calendar");
  const [size, setSize] = useCalendarSize();
  const queryClient = useQueryClient();
  const [today, setToday] = useState(() => kstDateKey(new Date()));
  const [date, setDate] = useState<DateKey>(today);
  const [view, setView] = useState<ViewMode>("day");
  const [mode, setMode] = useState<ColumnMode>("chair");
  const [booking, setBooking] = useState<BookingPrefill | null>(null);
  const [opened, setOpened] = useState<CalendarAppointment | null>(null);
  const [pendingMove, setPendingMove] = useState<({ id: string } & MoveTarget) | null>(null);
  const [toast, setToast] = useState<{ id: number; message: string; tone: ToastTone } | null>(null);

  const from = view === "day" ? date : kstWeekStart(date);
  const to = view === "day" ? date : addDays(from, 6);

  const appointments = useQuery({
    queryKey: [...APPOINTMENTS_QUERY_KEY, from, to],
    queryFn: () => apiFetch<{ items: CalendarAppointment[] }>(`/api/appointments?from=${from}&to=${to}`),
    placeholderData: keepPreviousData,
    refetchInterval: POLL_MS,
    staleTime: 0,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: APPOINTMENTS_QUERY_KEY });
  const notify = (message: string, tone: ToastTone) => setToast({ id: Date.now(), message, tone });

  const move = useMutation({
    mutationFn: ({ appointment, target }: { appointment: CalendarAppointment; target: MoveTarget }) =>
      apiFetch(`/api/appointments/${appointment.id}/move`, {
        method: "PATCH",
        body: {
          startAt: new Date(kstDayStart(date).getTime() + target.start * 60_000).toISOString(),
          ...(target.chair ? { chair: target.chair } : {}),
        },
      }),
    onMutate: ({ appointment, target }) => setPendingMove({ id: appointment.id, ...target }),
    onSuccess: async (_data, { target }) => {
      await refresh();
      notify(`${minutesToTime(target.start)}(으)로 옮겼습니다.`, "success");
    },
    onError: (error) => {
      // 원래 자리로 되돌아간다(pendingMove를 지우면 서버 값으로 그린다).
      notify(error instanceof ApiRequestError ? error.message : "옮기지 못했습니다. 다시 시도하세요.", "danger");
      void refresh();
    },
    onSettled: () => setPendingMove(null),
  });

  function goToday() {
    const now = kstDateKey(new Date());
    setToday(now);
    setDate(now);
  }

  const step = view === "day" ? 1 : 7;
  const label =
    view === "day" ? formatKstDateLabel(date) : `${formatKstDateLabel(from)} ~ ${formatKstShortDate(to)}`;
  const items = appointments.data?.items ?? [];
  const chairName = (code: string) => settings.chairs.find((c) => c.code === code)?.name ?? code;

  function openBooking(column: CalendarColumn, start: number) {
    setBooking({
      date,
      time: minutesToTime(start),
      ...(column.chair ? { chair: column.chair } : {}),
      ...(column.doctorId !== undefined ? { doctorId: column.doctorId } : {}),
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-2xl font-bold text-slate-900">예약 캘린더</h1>
        {canEditStyle && (
          <Toggle
            label="화면"
            value={tab}
            options={[
              { value: "calendar", label: "캘린더" },
              { value: "edit", label: "편집" },
            ]}
            onChange={setTab}
          />
        )}
      </div>

      {tab === "edit" ? (
        styleReady ? (
          <CalendarStyleEditor style={style} onSaved={(message) => notify(message, "success")} />
        ) : (
          <Spinner showLabel />
        )
      ) : (
      <>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={goToday}>
          오늘
        </Button>
        <Button variant="secondary" aria-label={view === "day" ? "이전 날" : "이전 주"} onClick={() => setDate(addDays(date, -step))}>
          ◀ 이전
        </Button>
        <Button variant="secondary" aria-label={view === "day" ? "다음 날" : "다음 주"} onClick={() => setDate(addDays(date, step))}>
          다음 ▶
        </Button>
        <p aria-live="polite" className="min-w-56 text-xl font-bold tabular-nums text-slate-900">
          {label}
        </p>
        <Input
          type="date"
          aria-label="날짜 선택"
          className="w-auto"
          value={date}
          onChange={(e) => {
            if (isValidDateKey(e.target.value)) setDate(e.target.value);
          }}
        />
        {appointments.isFetching && <Spinner label="새로 읽는 중" />}
        <div className="ml-auto flex flex-wrap gap-2">
          <Toggle
            label="보기"
            value={view}
            options={[
              { value: "day", label: "일" },
              { value: "week", label: "주" },
            ]}
            onChange={setView}
          />
          {view === "day" && (
            <Toggle
              label="열 기준"
              value={mode}
              options={[
                { value: "chair", label: "체어별" },
                { value: "doctor", label: "의사별" },
              ]}
              onChange={setMode}
            />
          )}
        </div>
      </div>

      <SizeControls size={size} onChange={setSize} showWidth={view === "day"} />
      <CalendarLegend style={style} />

      {appointments.isError && !appointments.data ? (
        <EmptyState
          title={appointments.error.message}
          action={<Button onClick={() => appointments.refetch()}>다시 시도</Button>}
        />
      ) : appointments.isPending ? (
        <Spinner showLabel />
      ) : view === "week" ? (
        <WeekView
          weekStart={from}
          today={today}
          businessHours={settings.businessHours}
          chairName={chairName}
          appointments={items}
          style={style}
          onOpenDay={(day) => {
            setDate(day);
            setView("day");
          }}
          onOpen={setOpened}
        />
      ) : (
        <DayPanel
          date={date}
          today={today}
          settings={settings}
          doctors={doctors}
          mode={mode}
          items={items}
          canWrite={canWrite}
          pendingMove={pendingMove}
          style={style}
          size={size}
          onGoTo={setDate}
          onCellClick={openBooking}
          onOpen={setOpened}
          onMove={(appointment, target) => move.mutate({ appointment, target })}
        />
      )}

      </>
      )}

      {booking && (
        <BookingDialog
          key={`${booking.date}-${booking.time}-${booking.chair}-${booking.doctorId}`}
          prefill={booking}
          settings={settings}
          doctors={doctors}
          style={style}
          onClose={() => setBooking(null)}
          onCreated={() => {
            setBooking(null);
            notify("예약을 등록했습니다.", "success");
            void refresh();
          }}
        />
      )}

      {opened && (
        <AppointmentDetailDialog
          key={opened.id}
          appointment={opened}
          chairs={settings.chairs}
          canWrite={canWrite}
          style={style}
          today={today}
          onClose={() => setOpened(null)}
          onMoved={refresh}
          onLabelsSaved={() => {
            notify("라벨을 저장했습니다.", "success");
            void refresh();
          }}
        />
      )}

      {toast && <Toast key={toast.id} message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </div>
  );
}

/** 일 보기 + 휴진 안내 */
function DayPanel({
  date,
  today,
  settings,
  doctors,
  mode,
  items,
  canWrite,
  pendingMove,
  style,
  size,
  onGoTo,
  onCellClick,
  onOpen,
  onMove,
}: {
  date: DateKey;
  /** 오늘(한국 시간). 지난 날에는 예약 등록·끌어 옮기기를 하지 않는다(서버도 거부한다). */
  today: DateKey;
  settings: ClinicSettings;
  doctors: DoctorOption[];
  mode: ColumnMode;
  items: CalendarAppointment[];
  canWrite: boolean;
  pendingMove: ({ id: string } & MoveTarget) | null;
  style: CalendarStyle;
  size: CalendarSize;
  onGoTo: (date: DateKey) => void;
  onCellClick: (column: CalendarColumn, start: number) => void;
  onOpen: (appointment: CalendarAppointment) => void;
  onMove: (appointment: CalendarAppointment, target: MoveTarget) => void;
}) {
  const hours = businessHoursOf(settings.businessHours, date);
  // 주 보기에서 넘어온 직후에는 이전 기간의 목록이 잠깐 남아 있을 수 있어 그날 예약만 고른다.
  const dayItems = items.filter((item) => kstDateKey(new Date(item.startAt)) === date);
  const range = gridRange(
    hours,
    dayItems.map((item) => {
      const start = minutesSinceDayStart(date, item.startAt);
      return { start, end: start + item.durationMin };
    }),
  );
  const columns = buildColumns(mode, settings.chairs, doctors, dayItems);
  const viewportHeight = useViewportHeight();
  // 세로 '화면 맞춤': 위쪽 메뉴·도구줄·범례·열 제목을 뺀 높이에 진료시간 전체가 들어가게
  const pxPerMin = range ? pxPerMinFor(size.height, range.end - range.start, viewportHeight - 330) : 2;

  let nextOpenDay: DateKey | null = null;
  if (!hours) {
    for (let i = 1; i <= 7 && !nextOpenDay; i += 1) {
      if (businessHoursOf(settings.businessHours, addDays(date, i))) nextOpenDay = addDays(date, i);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {!hours && (
        <EmptyState
          title="휴진일입니다"
          description={dayItems.length > 0 ? `이 날짜에 예약 ${dayItems.length}건이 있습니다.` : "이 날은 진료시간이 없어 예약을 받지 않습니다."}
          action={
            nextOpenDay && (
              <Button onClick={() => onGoTo(nextOpenDay)}>다음 진료일 {formatKstShortDate(nextOpenDay)}로</Button>
            )
          }
        />
      )}
      {range && (
        <DayView
          date={date}
          range={range}
          columns={columns}
          mode={mode}
          appointments={dayItems}
          canWrite={canWrite && hours !== null && date >= today}
          pendingMove={pendingMove}
          style={style}
          pxPerMin={pxPerMin}
          columnWidth={size.width}
          onCellClick={onCellClick}
          onOpen={onOpen}
          onMove={onMove}
        />
      )}
    </div>
  );
}

function Toggle<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex overflow-hidden rounded-lg border border-slate-300">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "min-h-11 px-4 text-base font-semibold",
            value === option.value ? "bg-blue-700 text-white" : "bg-white text-slate-700 hover:bg-slate-100",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** 칸 크기 (F-3) — 가로규격·세로규격. 이 브라우저에 기억한다. */
function SizeControls({
  size,
  onChange,
  showWidth,
}: {
  size: CalendarSize;
  onChange: (size: CalendarSize) => void;
  showWidth: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      {showWidth && (
        <div className="flex items-center gap-2">
          <Label htmlFor="calendar-width" className="mb-0 whitespace-nowrap">
            가로규격
          </Label>
          <Select
            id="calendar-width"
            className="w-auto"
            value={String(size.width)}
            onChange={(e) => {
              const found = COLUMN_WIDTH_OPTIONS.find((o) => String(o.value) === e.target.value);
              if (found) onChange({ ...size, width: found.value });
            }}
          >
            {COLUMN_WIDTH_OPTIONS.map((o) => (
              <option key={String(o.value)} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      )}
      {showWidth && (
        <div className="flex items-center gap-2">
          <Label htmlFor="calendar-height" className="mb-0 whitespace-nowrap">
            세로규격
          </Label>
          <Select
            id="calendar-height"
            className="w-auto"
            value={size.height}
            onChange={(e) => {
              const found = ROW_HEIGHT_OPTIONS.find((o) => o.value === e.target.value);
              if (found) onChange({ ...size, height: found.value });
            }}
          >
            {ROW_HEIGHT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      )}
    </div>
  );
}
