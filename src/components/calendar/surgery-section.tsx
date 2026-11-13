"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/auth/api-client";
import type { Permission } from "@/lib/auth/permissions";
import { STAFF_ROLE_LABEL, type StaffRole } from "@/lib/domain/staff";
import { formatKstDateLabel, formatKstTime, kstDateKey } from "@/lib/time/kst";
import { containsResidentRegistrationNumber, RRN_ERROR_MESSAGE } from "@/lib/validation/forbidden-text";
import { Badge, Button, FieldError, Spinner } from "@/components/ui";
import type { AppointmentDetail } from "./types";
import { allowsArea } from "@/lib/auth/screen-registry";

type StaffOption = { id: string; name: string; role: StaffRole };

/** 참여 직원 배지 색 — 간호를 눈에 띄게 */
const PARTICIPANT_TONE: Partial<Record<StaffRole, "info">> = { NURSE: "info" };

/**
 * 수술 기록 (F-11) — 참여 직원(간호·의사 등)과 수술 메모(실수 등, 원장·관리자만).
 * 메모는 따로 읽으며(조회 감사 로그), 일반 예약 응답에는 실리지 않는다.
 */
export function SurgerySection({
  data,
  permissions,
  onSaved,
}: {
  data: AppointmentDetail;
  permissions: readonly Permission[];
  onSaved: (message: string) => void;
}) {
  const canRecord = allowsArea(permissions, "surgery.participants");
  const canNote = allowsArea(permissions, "surgery.note");
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>(data.participants.map((p) => p.staffId));
  const staff = useQuery({
    queryKey: ["staff", "all"],
    queryFn: () => apiFetch<{ staff: StaffOption[] }>("/api/staff"),
    staleTime: 60_000,
    enabled: editing,
  });
  const save = useMutation({
    mutationFn: () => apiFetch(`/api/appointments/${data.id}/participants`, { method: "PUT", body: { staffIds: selected } }),
    onSuccess: () => {
      setEditing(false);
      onSaved("참여 직원을 저장했습니다.");
    },
  });

  // 간호를 먼저, 그다음 의사·나머지
  const order: StaffRole[] = ["NURSE", "DOCTOR", "COUNSELOR", "FRONT", "ADMIN"];
  const options = (staff.data?.staff ?? []).toSorted((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.name.localeCompare(b.name));

  return (
    <section aria-label="수술 기록" className="flex flex-col gap-2 rounded-lg border border-violet-200 bg-violet-50/40 p-3">
      <h3 className="text-base font-bold">수술 기록</h3>
      <div className="flex flex-wrap items-center gap-2 text-base">
        <span className="text-slate-600">참여 직원</span>
        {data.participants.length === 0 ? (
          <span className="text-slate-500">없음</span>
        ) : (
          data.participants.map((p) => (
            <Badge key={p.staffId} tone={PARTICIPANT_TONE[p.role] ?? "neutral"}>
              {p.name} ({STAFF_ROLE_LABEL[p.role]})
            </Badge>
          ))
        )}
        {canRecord && !editing && (
          <Button variant="ghost" onClick={() => setEditing(true)}>참여 직원 고치기</Button>
        )}
      </div>
      {editing && (
        <div className="flex flex-col gap-2">
          {staff.isPending ? (
            <Spinner showLabel />
          ) : (
            <div role="group" aria-label="참여 직원 고르기" className="flex flex-wrap gap-1.5">
              {options.map((s) => {
                const on = selected.includes(s.id);
                return (
                  <button key={s.id} type="button" aria-pressed={on} onClick={() => setSelected(on ? selected.filter((x) => x !== s.id) : [...selected, s.id])}
                    className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${on ? "border-violet-700 bg-violet-700 text-white" : "border-slate-300 bg-white"}`}>
                    {s.name} <span className="font-normal opacity-80">{STAFF_ROLE_LABEL[s.role]}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "저장 중…" : "참여 직원 저장"}</Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>취소</Button>
            {save.isError && <FieldError>{save.error instanceof ApiRequestError ? save.error.message : "저장하지 못했습니다."}</FieldError>}
          </div>
        </div>
      )}
      {canNote && <SurgeryNote appointmentId={data.id} onSaved={onSaved} />}
    </section>
  );
}

function SurgeryNote({ appointmentId, onSaved }: { appointmentId: string; onSaved: (message: string) => void }) {
  const note = useQuery({
    queryKey: ["surgery-note", appointmentId],
    queryFn: () => apiFetch<{ note: { content: string; updatedAt: string; updatedByName: string } | null }>(`/api/appointments/${appointmentId}/surgery-note`),
    staleTime: 0,
  });
  if (note.isPending) return <Spinner showLabel label="수술 메모를 불러오는 중" />;
  if (note.isError) return <FieldError>{note.error.message}</FieldError>;
  return <NoteEditor key={note.data.note?.updatedAt ?? "none"} appointmentId={appointmentId} initial={note.data.note} onSaved={async (m) => { await note.refetch(); onSaved(m); }} />;
}

function NoteEditor({
  appointmentId,
  initial,
  onSaved,
}: {
  appointmentId: string;
  initial: { content: string; updatedAt: string; updatedByName: string } | null;
  onSaved: (message: string) => void;
}) {
  const [content, setContent] = useState(initial?.content ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => apiFetch(`/api/appointments/${appointmentId}/surgery-note`, { method: "PUT", body: { content: content.trim() } }),
    onSuccess: () => onSaved("수술 메모를 저장했습니다."),
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : "저장하지 못했습니다."),
  });
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`surgery-note-${appointmentId}`} className="text-sm font-semibold text-slate-700">
        수술 메모 (원장·관리자만 보임 — 실수·특이사항, 진단·처방은 적지 않음)
      </label>
      <textarea id={`surgery-note-${appointmentId}`} rows={3} maxLength={2000} value={content} onChange={(e) => setContent(e.target.value)}
        className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-base" />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          disabled={save.isPending || content.trim() === (initial?.content ?? "")}
          onClick={() => {
            if (containsResidentRegistrationNumber(content)) return setError(RRN_ERROR_MESSAGE);
            setError(null);
            save.mutate();
          }}
        >
          {save.isPending ? "저장 중…" : "수술 메모 저장"}
        </Button>
        {initial && (
          <span className="text-sm text-slate-500">
            {initial.updatedByName} · {formatKstDateLabel(kstDateKey(new Date(initial.updatedAt)))} {formatKstTime(new Date(initial.updatedAt))}
          </span>
        )}
        {error && <FieldError>{error}</FieldError>}
      </div>
    </div>
  );
}
