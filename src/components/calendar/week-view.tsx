"use client";

import { businessHoursOf } from "@/lib/calendar/layout";
import { APPOINTMENT_STATUS_LABEL } from "@/lib/domain/appointment";
import type { BusinessHours } from "@/lib/domain/clinic";
import { addDays, type DateKey, formatKstDateLabel, formatKstShortDate, formatKstTime, kstDateKey } from "@/lib/time/kst";
import { Badge, cn } from "@/components/ui";
import { blockColor, type CalendarAppointment, isDimmedStatus, STATUS_TONE } from "./types";

/**
 * 주 보기 — 월요일부터 7일. 하루에 한 열(모든 체어를 함께), 시간순 목록.
 * 날짜 제목을 누르면 그날의 일 보기로, 예약을 누르면 상세로 간다. 끌어 옮기기는 일 보기에서만 한다.
 */
export function WeekView({
  weekStart,
  today,
  businessHours,
  chairName,
  appointments,
  onOpenDay,
  onOpen,
}: {
  weekStart: DateKey;
  today: DateKey;
  businessHours: BusinessHours;
  chairName: (code: string) => string;
  appointments: CalendarAppointment[];
  onOpenDay: (date: DateKey) => void;
  onOpen: (appointment: CalendarAppointment) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const byDay = new Map<DateKey, CalendarAppointment[]>(days.map((day) => [day, []]));
  for (const appointment of appointments) byDay.get(kstDateKey(new Date(appointment.startAt)))?.push(appointment);

  return (
    <div className="grid max-h-[calc(100vh-190px)] min-h-80 grid-cols-7 overflow-auto rounded-xl border border-slate-300 bg-white">
      {days.map((day) => {
        const items = (byDay.get(day) ?? []).toSorted((a, b) => a.startAt.localeCompare(b.startAt));
        const closed = businessHoursOf(businessHours, day) === null;
        const active = items.filter((item) => !isDimmedStatus(item.status)).length;
        return (
          <section key={day} aria-label={formatKstDateLabel(day)} className="flex min-w-0 flex-col border-l border-slate-300 first:border-l-0">
            <button
              type="button"
              onClick={() => onOpenDay(day)}
              aria-label={`${formatKstDateLabel(day)} 일 보기`}
              className={cn(
                "sticky top-0 z-10 border-b border-slate-300 px-2 py-2 text-center hover:bg-blue-50",
                day === today ? "bg-blue-100" : "bg-slate-50",
              )}
            >
              <span className="block text-base font-bold text-slate-900">{formatKstShortDate(day)}</span>
              <span className="block text-sm text-slate-600">{closed ? "휴진" : `예약 ${active}건`}</span>
            </button>
            <ul className="flex flex-col gap-1 p-1">
              {items.map((item) => {
                const time = formatKstTime(new Date(item.startAt));
                const status = APPOINTMENT_STATUS_LABEL[item.status];
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(item)}
                      aria-label={`${day} ${time} ${item.patientNameMasked} ${item.treatmentItem} ${status} 예약`}
                      className={cn(
                        "w-full rounded-md border border-l-4 px-1.5 py-1 text-left text-sm leading-tight hover:shadow",
                        blockColor(item.status),
                      )}
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
                      <span className="block truncate text-slate-700">
                        {item.treatmentItem} · {chairName(item.chair)}
                      </span>
                      <Badge tone={STATUS_TONE[item.status]} className="mt-0.5 px-1 py-0 text-xs">
                        {status}
                      </Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
