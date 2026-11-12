"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/auth/api-client";
import type { BusinessHours, ClinicSettings } from "@/lib/domain/clinic";
import { isValidTime } from "@/lib/time/kst";
import { Button, Card, CardTitle, FieldError, Input } from "@/components/ui";

const DAYS: { key: keyof BusinessHours; label: string }[] = [
  { key: "1", label: "월" },
  { key: "2", label: "화" },
  { key: "3", label: "수" },
  { key: "4", label: "목" },
  { key: "5", label: "금" },
  { key: "6", label: "토" },
  { key: "0", label: "일" },
];
const C = "min-h-9 py-1 text-sm";

/** 진료시간·지각 허용·노쇼 유예 시간 (F-14, T4-4). 캘린더 칸, 지각 판정, [노쇼] 버튼 시각에 바로 쓰인다. */
export function ClinicRulesEditor({ settings, onSaved }: { settings: ClinicSettings; onSaved: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [hours, setHours] = useState<BusinessHours>(() => ({ ...settings.businessHours }));
  const [late, setLate] = useState(String(settings.lateToleranceMin));
  const [grace, setGrace] = useState(String(settings.noShowGraceMin));

  const problems: string[] = [];
  if (!/^\d+$/.test(late) || Number(late) > 120) problems.push("지각 허용시간은 0~120분입니다.");
  if (!/^\d+$/.test(grace) || Number(grace) > 240) problems.push("노쇼 유예시간은 0~240분입니다.");
  for (const d of DAYS) {
    const h = hours[d.key];
    if (h && (!isValidTime(h.open) || !isValidTime(h.close) || h.open >= h.close)) problems.push(`${d.label}요일 진료시간을 확인하세요(시작 < 끝).`);
  }

  const save = useMutation({
    mutationFn: () =>
      apiFetch("/api/settings/clinic", {
        method: "PUT",
        body: { lateToleranceMin: Number(late), noShowGraceMin: Number(grace), businessHours: hours },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      onSaved("진료시간·기준을 저장했습니다.");
    },
  });

  return (
    <Card className="p-3">
      <CardTitle>진료시간·기준</CardTitle>
      <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        {DAYS.map((d) => {
          const h = hours[d.key];
          return (
            <div key={d.key} className="contents">
              <label className="flex items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={h !== null}
                  onChange={(e) => setHours({ ...hours, [d.key]: e.target.checked ? { open: "09:30", close: "18:30" } : null })}
                />
                {d.label}요일 진료
              </label>
              <div className="flex items-center gap-2">
                {h ? (
                  <>
                    <Input aria-label={`${d.label}요일 시작`} type="time" className={`${C} w-32`} value={h.open} onChange={(e) => setHours({ ...hours, [d.key]: { ...h, open: e.target.value } })} />
                    ~
                    <Input aria-label={`${d.label}요일 끝`} type="time" className={`${C} w-32`} value={h.close} onChange={(e) => setHours({ ...hours, [d.key]: { ...h, close: e.target.value } })} />
                  </>
                ) : (
                  <span className="text-slate-500">휴진</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-4 text-sm">
        <label className="flex items-center gap-2">
          지각 허용시간
          <Input aria-label="지각 허용시간(분)" inputMode="numeric" className={`${C} w-20 text-right`} value={late} onChange={(e) => setLate(e.target.value.replace(/\D/g, ""))} />분
        </label>
        <label className="flex items-center gap-2">
          노쇼 유예시간
          <Input aria-label="노쇼 유예시간(분)" inputMode="numeric" className={`${C} w-20 text-right`} value={grace} onChange={(e) => setGrace(e.target.value.replace(/\D/g, ""))} />분
        </label>
        <Button className={C} disabled={problems.length > 0 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "저장 중…" : "진료시간·기준 저장"}</Button>
      </div>
      <div role="alert" className="mt-1">
        {problems.map((p) => <FieldError key={p}>{p}</FieldError>)}
        {save.isError && <FieldError>{save.error instanceof ApiRequestError ? save.error.message : "저장하지 못했습니다."}</FieldError>}
      </div>
    </Card>
  );
}
