"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/auth/api-client";
import type { ClinicSettings } from "@/lib/domain/clinic";
import {
  PRICE_MAX,
  TREATMENT_CATEGORIES,
  TREATMENT_CATEGORY_LABEL,
  type TreatmentCategory,
  treatmentColorOf,
  treatmentMetaOf,
} from "@/lib/domain/treatment";
import { isHexColor } from "@/lib/calendar/colors";
import { usePermissions } from "@/components/auth/use-permissions";
import { Button, Card, CardTitle, FieldError, Input, Select } from "@/components/ui";

type Draft = { key: string; name: string; category: TreatmentCategory; price: string; color: string };

let seq = 0;
const toDraft = (settings: ClinicSettings): Draft[] =>
  settings.treatmentItems.map((name) => {
    const meta = treatmentMetaOf(settings.treatmentItemMeta, name);
    return { key: `i-${(seq += 1)}`, name, category: meta.category, price: String(meta.price ?? 0), color: treatmentColorOf(settings.treatmentItemMeta, name) ?? "#E0E0E0" };
  });

/**
 * [편집] 탭의 예약 항목 — F-5(고가·일반 구분: 상담실에는 고가만), F-6(단가: 실적 금액).
 * 저장하면 새 예약부터 이 단가가 쓰인다. 이미 있는 예약의 항목 이름·단가는 그대로다.
 * 단가 칸은 금액 권한(appointment.price)이 있을 때만 보이고, 없으면 단가를 보내지 않는다(서버가 기존 단가를 유지, S-3).
 */
export function TreatmentItemsEditor({ settings, onSaved }: { settings: ClinicSettings; onSaved: (message: string) => void }) {
  const queryClient = useQueryClient();
  const canPrice = usePermissions().has("appointment.price");
  const [items, setItems] = useState<Draft[]>(() => toDraft(settings));

  const problems: string[] = [];
  const names = items.map((item) => item.name.trim());
  if (items.length === 0) problems.push("예약 항목이 하나 이상 있어야 합니다.");
  if (names.some((name) => !name)) problems.push("이름이 빈 예약 항목이 있습니다.");
  if (new Set(names.filter(Boolean)).size !== names.filter(Boolean).length) problems.push("같은 이름의 예약 항목이 있습니다.");
  if (canPrice && items.some((item) => !/^\d+$/.test(item.price) || Number(item.price) > PRICE_MAX)) problems.push("단가는 0 이상의 원 단위 숫자로 입력하세요.");
  if (items.some((item) => !isHexColor(item.color))) problems.push("색은 #RRGGBB 형식이어야 합니다.");

  const save = useMutation({
    mutationFn: () =>
      apiFetch("/api/settings/treatment-items", {
        method: "PUT",
        body: {
          items: items.map((item) => ({
            name: item.name.trim(),
            category: item.category,
            ...(canPrice ? { price: Number(item.price) } : {}),
            color: item.color,
          })),
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      onSaved("예약 항목을 저장했습니다.");
    },
  });

  const update = (key: string, patch: Partial<Draft>) => setItems((list) => list.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  const move = (index: number, delta: number) =>
    setItems((list) => {
      const target = index + delta;
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  return (
    <Card className="p-4">
      <CardTitle>예약 항목 (구분·단가)</CardTitle>
      <p className="mb-3 text-sm text-slate-600">
        <strong>고가(상담 대상)</strong> 항목만 상담실 열에 예약할 수 있습니다. 단가는 의사·상담자 실적 금액(단가 × (100 − 할인율)%)에 쓰입니다.
        처음 값은 예시이니 병원 단가로 바꾸세요. 이름을 바꾸면 이미 있는 예약은 옛 이름으로 남습니다.
      </p>
      <ol className="flex flex-col gap-2">
        {items.map((item, index) => (
          <li key={item.key} className="flex flex-wrap items-center gap-2" aria-label={`예약 항목 ${index + 1}`}>
            <span className="w-6 text-right text-sm tabular-nums text-slate-500">{index + 1}</span>
            <Button variant="ghost" aria-label={`${item.name} 위로`} disabled={index === 0} onClick={() => move(index, -1)}>
              ▲
            </Button>
            <Button variant="ghost" aria-label={`${item.name} 아래로`} disabled={index === items.length - 1} onClick={() => move(index, 1)}>
              ▼
            </Button>
            <input
              type="color"
              aria-label={`${item.name || "새 항목"} 칸 색`}
              className="h-11 w-12 cursor-pointer rounded border border-slate-300 bg-white p-1"
              value={isHexColor(item.color) ? item.color.toLowerCase() : "#e0e0e0"}
              onChange={(e) => update(item.key, { color: e.target.value.toUpperCase() })}
            />
            <Input aria-label={`예약 항목 ${index + 1} 이름`} className="w-40" maxLength={30} value={item.name} onChange={(e) => update(item.key, { name: e.target.value })} />
            <Select
              aria-label={`${item.name || "새 항목"} 구분`}
              className="w-auto"
              value={item.category}
              onChange={(e) => update(item.key, { category: e.target.value as TreatmentCategory })}
            >
              {TREATMENT_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {TREATMENT_CATEGORY_LABEL[category]}
                </option>
              ))}
            </Select>
            {canPrice && (
            <span className="flex items-center gap-1">
              <Input
                aria-label={`${item.name || "새 항목"} 단가(원)`}
                inputMode="numeric"
                className="w-36 text-right tabular-nums"
                value={item.price}
                onChange={(e) => update(item.key, { price: e.target.value.replace(/[^\d]/g, "") })}
              />
              원
            </span>
            )}
            <Button variant="ghost" className="text-red-700" aria-label={`${item.name} 삭제`} onClick={() => setItems((list) => list.filter((x) => x.key !== item.key))}>
              삭제
            </Button>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => setItems((list) => [...list, { key: `i-${(seq += 1)}`, name: "", category: "GENERAL", price: "0", color: "#E0E0E0" }])}>
          + 예약 항목 추가
        </Button>
        <Button disabled={problems.length > 0 || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "저장 중…" : "예약 항목 저장"}
        </Button>
        <div role="alert">
          {problems.map((problem) => (
            <FieldError key={problem}>{problem}</FieldError>
          ))}
          {save.isError && <FieldError>{save.error instanceof ApiRequestError ? save.error.message : "저장하지 못했습니다."}</FieldError>}
        </div>
      </div>
    </Card>
  );
}
