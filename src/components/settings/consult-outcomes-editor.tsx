"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/auth/api-client";
import { isHexColor } from "@/lib/calendar/colors";
import { CONSULT_OUTCOME_KIND_LABEL, CONSULT_OUTCOME_KINDS, type ConsultOutcome, type ConsultOutcomeKind } from "@/lib/domain/consult";
import { Button, Card, CardTitle, FieldError, Input, Select, Spinner } from "@/components/ui";

type Draft = ConsultOutcome & { key: string };
let seq = 0;

/** 상담 결과 분류 (F-10) — 이름·색·종류. 종류가 통계(초진·전환율)의 기준이다. 저장된 상담의 분류 이름은 그대로 남는다. */
export function ConsultOutcomesEditor({ onSaved }: { onSaved: (message: string) => void }) {
  const current = useQuery({ queryKey: ["consult-outcomes"], queryFn: () => apiFetch<{ outcomes: ConsultOutcome[] }>("/api/settings/consult-outcomes") });
  if (current.isPending) return <Spinner showLabel />;
  if (current.isError) return <FieldError>{current.error.message}</FieldError>;
  return <Editor key={JSON.stringify(current.data.outcomes)} initial={current.data.outcomes} onSaved={onSaved} />;
}

function Editor({ initial, onSaved }: { initial: ConsultOutcome[]; onSaved: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Draft[]>(() => initial.map((o) => ({ ...o, key: `o-${(seq += 1)}` })));
  const update = (key: string, patch: Partial<Draft>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const names = rows.map((r) => r.name.trim());
  const problems: string[] = [];
  if (names.some((n) => !n)) problems.push("이름이 빈 분류가 있습니다.");
  if (new Set(names).size !== names.length) problems.push("같은 이름의 분류가 있습니다.");
  if (!rows.some((r) => r.kind === "SURGERY")) problems.push("'수술예약' 종류의 분류가 하나 이상 있어야 합니다.");
  if (rows.some((r) => !isHexColor(r.color))) problems.push("색은 #RRGGBB 형식입니다.");

  const save = useMutation({
    mutationFn: () => apiFetch("/api/settings/consult-outcomes", { method: "PUT", body: { outcomes: rows.map(({ name, color, kind }) => ({ name: name.trim(), color, kind })) } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["consult-outcomes"] });
      await queryClient.invalidateQueries({ queryKey: ["consultations"] });
      onSaved("상담 결과 분류를 저장했습니다.");
    },
  });

  return (
    <Card className="p-3">
      <CardTitle>상담 결과</CardTitle>
      <p className="mb-2 text-sm text-slate-600">
        종류: 대기·진행(아직 결정 전) / 수술예약(전환) / 일반진료 / 실패·불가. 전환율 = 수술예약 ÷ (수술예약 + 일반진료 + 실패).
      </p>
      <ol className="flex flex-col gap-1">
        {rows.map((r, i) => (
          <li key={r.key} className="flex flex-wrap items-center gap-1.5" aria-label={`상담 결과 ${i + 1}`}>
            <span className="w-5 text-right text-xs text-slate-500">{i + 1}</span>
            <Button variant="ghost" aria-label={`${r.name} 위로`} disabled={i === 0} onClick={() => setRows((l) => { const n = [...l]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}>▲</Button>
            <Button variant="ghost" aria-label={`${r.name} 아래로`} disabled={i === rows.length - 1} onClick={() => setRows((l) => { const n = [...l]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n; })}>▼</Button>
            <input type="color" aria-label={`${r.name} 색`} className="h-9 w-10 cursor-pointer rounded border border-slate-300 p-0.5" value={isHexColor(r.color) ? r.color.toLowerCase() : "#000000"} onChange={(e) => update(r.key, { color: e.target.value.toUpperCase() })} />
            <Input aria-label={`상담 결과 ${i + 1} 이름`} className="w-32" maxLength={12} value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} />
            <Select aria-label={`${r.name} 종류`} className="w-auto" value={r.kind} onChange={(e) => update(r.key, { kind: e.target.value as ConsultOutcomeKind })}>
              {CONSULT_OUTCOME_KINDS.map((k) => <option key={k} value={k}>{CONSULT_OUTCOME_KIND_LABEL[k]}</option>)}
            </Select>
            <Button variant="ghost" className="text-red-700" aria-label={`${r.name} 삭제`} onClick={() => setRows((l) => l.filter((x) => x.key !== r.key))}>삭제</Button>
          </li>
        ))}
      </ol>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={rows.length >= 20} onClick={() => setRows((l) => [...l, { key: `o-${(seq += 1)}`, name: "", color: "#B0BEC5", kind: "PENDING" }])}>+ 분류 추가</Button>
        <Button disabled={problems.length > 0 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "저장 중…" : "상담 결과 저장"}</Button>
        <div role="alert">
          {problems.map((p) => <FieldError key={p}>{p}</FieldError>)}
          {save.isError && <FieldError>{save.error instanceof ApiRequestError ? save.error.message : "저장하지 못했습니다."}</FieldError>}
        </div>
      </div>
    </Card>
  );
}
