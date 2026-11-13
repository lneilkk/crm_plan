"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/auth/api-client";
import type { Chair, ClinicSettings } from "@/lib/domain/clinic";
import { Button, Card, CardTitle, FieldError, Input, Select } from "@/components/ui";

type Draft = Chair & { key: string; saved: boolean };
let seq = 0;
const C = "min-h-9 py-1 text-sm";

/**
 * 체어·열 (F-14, T4-4) — 캘린더 열의 순서·이름·묶음(과)·종류. 코드는 예약에 저장되므로 저장한 뒤에는 바꾸지 않는다.
 * 묶음 이름이 같은 열은 캘린더에서 한데 묶여 위에 묶음 이름이 보인다.
 */
export function ChairsEditor({ settings, onSaved }: { settings: ClinicSettings; onSaved: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Draft[]>(() => settings.chairs.map((c) => ({ ...c, key: `c-${(seq += 1)}`, saved: true })));
  const update = (key: string, patch: Partial<Draft>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, d: number) =>
    setRows((list) => {
      if (i + d < 0 || i + d >= list.length) return list;
      const next = [...list];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return next;
    });

  const codes = rows.map((r) => r.code.trim());
  const problems: string[] = [];
  if (codes.some((c) => !/^[A-Za-z0-9가-힣_-]{1,10}$/.test(c))) problems.push("코드는 영문·숫자·한글·_- 로 1~10자입니다.");
  if (new Set(codes).size !== codes.length) problems.push("같은 코드가 두 번 있습니다.");
  if (rows.some((r) => !r.name.trim())) problems.push("이름이 빈 열이 있습니다.");
  if (!rows.some((r) => r.kind === "CHAIR")) problems.push("진료 체어가 하나 이상 있어야 합니다.");

  const save = useMutation({
    mutationFn: () =>
      apiFetch("/api/settings/chairs", {
        method: "PUT",
        body: { chairs: rows.map((r) => ({ code: r.code.trim(), name: r.name.trim(), kind: r.kind, ...(r.group?.trim() ? { group: r.group.trim() } : {}) })) },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      setRows((list) => list.map((r) => ({ ...r, saved: true })));
      onSaved("체어·열을 저장했습니다.");
    },
  });

  return (
    <Card className="p-3">
      <CardTitle>체어·열</CardTitle>
      <p className="mb-2 text-sm text-slate-600">캘린더 열 순서대로입니다. 묶음 이름(예: 보철과·수술과)이 같은 열은 위에 묶음 이름이 함께 보입니다. 상담실 종류에는 고가 항목 예약만 들어갑니다.</p>
      <table className="w-full text-sm">
        <thead className="text-left text-slate-600">
          <tr>
            <th className="w-16 py-1" />
            <th className="py-1">코드</th>
            <th className="py-1">이름</th>
            <th className="py-1">묶음(과)</th>
            <th className="py-1">종류</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key} className="border-t border-slate-100" aria-label={`열 ${i + 1}`}>
              <td className="whitespace-nowrap py-1">
                <Button variant="ghost" className={C} aria-label={`${r.name} 위로`} disabled={i === 0} onClick={() => move(i, -1)}>▲</Button>
                <Button variant="ghost" className={C} aria-label={`${r.name} 아래로`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>▼</Button>
              </td>
              <td className="py-1 pr-2">
                <Input aria-label={`열 ${i + 1} 코드`} className={`${C} w-24`} value={r.code} disabled={r.saved} title={r.saved ? "저장한 코드는 바꿀 수 없습니다" : undefined} onChange={(e) => update(r.key, { code: e.target.value })} />
              </td>
              <td className="py-1 pr-2"><Input aria-label={`열 ${i + 1} 이름`} className={C} maxLength={20} value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} /></td>
              <td className="py-1 pr-2"><Input aria-label={`열 ${i + 1} 묶음`} className={C} maxLength={20} value={r.group ?? ""} onChange={(e) => update(r.key, { group: e.target.value })} /></td>
              <td className="py-1 pr-2">
                <Select aria-label={`열 ${i + 1} 종류`} className={`${C} w-auto`} value={r.kind} onChange={(e) => update(r.key, { kind: e.target.value as Chair["kind"] })}>
                  <option value="CHAIR">진료 체어</option>
                  <option value="CONSULT_ROOM">상담실</option>
                </Select>
              </td>
              <td className="py-1">
                <Button variant="ghost" className={`${C} text-red-700`} aria-label={`${r.name} 빼기`} onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}>빼기</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="secondary" className={C} onClick={() => setRows((list) => [...list, { key: `c-${(seq += 1)}`, code: "", name: "", kind: "CHAIR", group: list.at(-1)?.group, saved: false }])}>
          + 열 추가
        </Button>
        <Button className={C} disabled={problems.length > 0 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "저장 중…" : "체어·열 저장"}</Button>
        <div role="alert">
          {problems.map((p) => <FieldError key={p}>{p}</FieldError>)}
          {save.isError && <FieldError>{save.error instanceof ApiRequestError ? save.error.message : "저장하지 못했습니다."}</FieldError>}
        </div>
      </div>
    </Card>
  );
}
