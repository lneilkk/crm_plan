"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch, type Me, ME_QUERY_KEY } from "@/lib/auth/api-client";
import { can } from "@/lib/auth/permissions";
import { readableTextColor } from "@/lib/calendar/colors";
import { type ConsultOutcome, CONSULT_OUTCOME_KIND_LABEL, summarizeConsultations } from "@/lib/domain/consult";
import type { ClinicSettings } from "@/lib/domain/clinic";
import { addDays, type DateKey, formatKstDateLabel, formatKstShortDate, formatKstTime, isValidDateKey, kstDateKey } from "@/lib/time/kst";
import { Badge, Button, cn, EmptyState, Input, Spinner, Toast, type ToastTone } from "@/components/ui";
import { ConsultDetailDialog } from "./consult-detail-dialog";
import { ConsultNewDialog } from "./consult-new-dialog";

export type ConsultItem = {
  id: string;
  patientId: string;
  patientNameMasked: string;
  isNewPatient: boolean;
  counselorId: string;
  counselorName: string;
  consultedAt: string;
  interestedItems: string[];
  outcome: string | null;
  result: "PENDING" | "BOOKED" | "NOT_BOOKED";
  appointment: { id: string; startAt: string; treatmentItem: string; status: string } | null;
};

export type StaffOption = { id: string; name: string };

/**
 * 상담 탭 — F-10(Task.md T6-1·T6-2). 날짜별 보드: 신환상담·구환상담 묶음 × 상담자 열, 카드 = 상담 한 건.
 * 위쪽 요약은 그날 상담 수·결과 종류별 수·전환율(수술예약 ÷ 끝난 상담). 상담 내용은 카드를 눌러 상세에서만 본다.
 */
export function ConsultScreen() {
  const queryClient = useQueryClient();
  const [today] = useState(() => kstDateKey(new Date()));
  const [date, setDate] = useState<DateKey>(today);
  const [opened, setOpened] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<{ id: number; message: string; tone: ToastTone } | null>(null);

  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: () => apiFetch<Me>("/api/auth/me"), staleTime: 60_000 });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => apiFetch<ClinicSettings>("/api/settings"), staleTime: 60_000 });
  const counselors = useQuery({ queryKey: ["staff", "COUNSELOR"], queryFn: () => apiFetch<{ staff: StaffOption[] }>("/api/staff?role=COUNSELOR"), staleTime: 60_000 });
  const doctors = useQuery({ queryKey: ["staff", "DOCTOR"], queryFn: () => apiFetch<{ staff: StaffOption[] }>("/api/staff?role=DOCTOR"), staleTime: 60_000 });
  const list = useQuery({
    queryKey: ["consultations", date],
    queryFn: () => apiFetch<{ items: ConsultItem[]; outcomes: ConsultOutcome[] }>(`/api/consultations?date=${date}`),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  if (me.isPending || settings.isPending || counselors.isPending || doctors.isPending) return <Spinner showLabel />;
  if (!me.data || !settings.data || !counselors.data || !doctors.data) return <EmptyState title="불러오지 못했습니다" />;
  const canWrite = can(me.data.role, "consult.write");
  const items = list.data?.items ?? [];
  const outcomes = list.data?.outcomes ?? [];
  const summary = summarizeConsultations(items, outcomes);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["consultations"] });
  const notify = (message: string, tone: ToastTone = "success") => setToast({ id: Date.now(), message, tone });

  // 열: 상담자(활성) + 그날 상담이 있는 다른 담당자(관리자 등)
  const columns: StaffOption[] = [...counselors.data.staff];
  for (const item of items) if (!columns.some((c) => c.id === item.counselorId)) columns.push({ id: item.counselorId, name: item.counselorName });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-2xl font-bold text-slate-900">상담</h1>
        <Button variant="secondary" onClick={() => setDate(today)}>오늘</Button>
        <Button variant="secondary" aria-label="이전 날" onClick={() => setDate(addDays(date, -1))}>◀</Button>
        <Button variant="secondary" aria-label="다음 날" onClick={() => setDate(addDays(date, 1))}>▶</Button>
        <p aria-live="polite" className="min-w-48 text-xl font-bold tabular-nums">{formatKstDateLabel(date)}</p>
        <Input type="date" aria-label="날짜 선택" className="w-auto" value={date} onChange={(e) => isValidDateKey(e.target.value) && setDate(e.target.value)} />
        {list.isFetching && <Spinner label="새로 읽는 중" />}
        {canWrite && <Button className="ml-auto" onClick={() => setCreating(true)}>+ 상담 등록</Button>}
      </div>

      <section aria-label="상담 요약" className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <Stat label="전체 상담" value={summary.total.count} />
        <Stat label="초진(신환) 상담" value={summary.total.newPatient} />
        <Stat label="구환 추가상담" value={summary.total.returning} />
        {(["SURGERY", "GENERAL", "FAILED", "PENDING"] as const).map((kind) => (
          <Stat key={kind} label={CONSULT_OUTCOME_KIND_LABEL[kind]} value={summary.total[kind]} />
        ))}
        <Stat label="전환율" value={summary.total.conversionRate === null ? "-" : `${Math.round(summary.total.conversionRate * 100)}%`} />
      </section>

      {list.isError ? (
        <EmptyState title={list.error.message} action={<Button onClick={() => list.refetch()}>다시 시도</Button>} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-300 bg-white">
          <div className="flex min-w-max">
            {([true, false] as const).map((isNew) => (
              <div key={String(isNew)} className="flex border-l-4 border-l-slate-500 first:border-l-0">
                {columns.map((counselor) => {
                  const cards = items.filter((i) => i.isNewPatient === isNew && i.counselorId === counselor.id);
                  return (
                    <section key={counselor.id} aria-label={`${isNew ? "신환상담" : "구환상담"} ${counselor.name}`} className="w-44 border-l border-slate-200 first:border-l-0">
                      <header className="sticky top-0 border-b border-slate-300 bg-slate-50 px-2 py-1.5 text-center">
                        <span className="block text-xs text-slate-500">{isNew ? "신환상담" : "구환상담"}</span>
                        <span className="text-sm font-bold">{counselor.name}</span>
                      </header>
                      <ul className="flex min-h-40 flex-col gap-1 p-1">
                        {cards.map((item) => (
                          <li key={item.id}>
                            <ConsultCard item={item} outcomes={outcomes} onOpen={() => setOpened(item.id)} />
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      <CounselorMonth today={today} />

      <div aria-label="결과 분류" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {outcomes.map((o) => (
          <span key={o.name} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block size-3.5 rounded-sm border border-black/20" style={{ backgroundColor: o.color }} />
            {o.name} <span className="text-slate-400">({CONSULT_OUTCOME_KIND_LABEL[o.kind]})</span>
          </span>
        ))}
      </div>

      {creating && (
        <ConsultNewDialog
          date={date}
          me={me.data}
          counselors={columns}
          outcomes={outcomes}
          settings={settings.data}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            notify("상담을 등록했습니다.");
            void refresh();
          }}
        />
      )}
      {opened && (
        <ConsultDetailDialog
          key={opened}
          id={opened}
          canWrite={canWrite}
          outcomes={outcomes}
          counselors={columns}
          doctors={doctors.data.staff}
          settings={settings.data}
          today={today}
          onClose={() => setOpened(null)}
          onChanged={(message) => {
            notify(message);
            void refresh();
          }}
        />
      )}
      {toast && <Toast key={toast.id} message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-white p-2 shadow-sm ring-1 ring-slate-200">
      <p className="text-xs text-slate-600">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function ConsultCard({ item, outcomes, onOpen }: { item: ConsultItem; outcomes: ConsultOutcome[]; onOpen: () => void }) {
  const outcome = outcomes.find((o) => o.name === item.outcome);
  const color = outcome?.color ?? "#ECEFF1";
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${formatKstTime(new Date(item.consultedAt))} ${item.patientNameMasked} ${item.outcome ?? "대기"} 상담`}
      className={cn("w-full rounded-md border border-l-4 px-1.5 py-1 text-left text-sm leading-tight hover:shadow")}
      style={{ borderLeftColor: color }}
    >
      <span className="flex items-center gap-1">
        <span className="font-bold tabular-nums">{formatKstTime(new Date(item.consultedAt))}</span>
        <span className="truncate font-semibold">{item.patientNameMasked}</span>
      </span>
      {item.interestedItems.length > 0 && <span className="block truncate text-xs text-slate-600">{item.interestedItems.join(", ")}</span>}
      <span className="mt-0.5 flex flex-wrap items-center gap-1">
        <span className="rounded px-1 text-xs font-semibold" style={{ backgroundColor: color, color: readableTextColor(color) }}>
          {item.outcome ?? "대기"}
        </span>
        {item.appointment && <Badge tone="info" className="px-1 py-0 text-xs">→ {formatKstShortDate(kstDateKey(new Date(item.appointment.startAt)))} 수술예약</Badge>}
      </span>
    </button>
  );
}

type CounselorStat = { counselorId: string; counselorName: string; count: number; newPatient: number; returning: number; SURGERY: number; GENERAL: number; FAILED: number; PENDING: number; conversionRate: number | null };

/** 상담자별 이번 달(1일~오늘) 전환율 — T6-2 */
function CounselorMonth({ today }: { today: DateKey }) {
  const from = `${today.slice(0, 7)}-01`;
  const stats = useQuery({
    queryKey: ["consultations", "stats", from, today],
    queryFn: () => apiFetch<{ byCounselor: CounselorStat[] }>(`/api/consultations/stats?from=${from}&to=${today}`),
  });
  if (!stats.data || stats.data.byCounselor.length === 0) return null;
  return (
    <section aria-label="상담자별 이번 달" className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
      <h2 className="mb-1 text-base font-bold">상담자별 이번 달</h2>
      <table className="w-full text-sm">
        <thead className="text-left text-slate-600">
          <tr><th>상담자</th><th className="text-right">상담</th><th className="text-right">신환</th><th className="text-right">수술예약</th><th className="text-right">일반진료</th><th className="text-right">실패</th><th className="text-right">전환율</th></tr>
        </thead>
        <tbody>
          {stats.data.byCounselor.map((c) => (
            <tr key={c.counselorId} className="border-t border-slate-100 tabular-nums">
              <td>{c.counselorName}</td><td className="text-right">{c.count}</td><td className="text-right">{c.newPatient}</td><td className="text-right">{c.SURGERY}</td>
              <td className="text-right">{c.GENERAL}</td><td className="text-right">{c.FAILED}</td>
              <td className="text-right font-semibold">{c.conversionRate === null ? "-" : `${Math.round(c.conversionRate * 100)}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
