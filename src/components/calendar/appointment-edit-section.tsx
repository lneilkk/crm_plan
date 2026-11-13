"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/auth/api-client";
import { SLOT_HOLDING_STATUSES } from "@/lib/domain/appointment";
import type { ClinicSettings } from "@/lib/domain/clinic";
import { amountAfterDiscount, isPremiumItem, isValidDiscountRate, treatmentMetaOf } from "@/lib/domain/treatment";
import { kstDateKey } from "@/lib/time/kst";
import { containsResidentRegistrationNumber, MEMO_GUIDE, RRN_ERROR_MESSAGE } from "@/lib/validation/forbidden-text";
import { Button, FieldError, Input, Label, Select } from "@/components/ui";
import type { AppointmentDetail, DoctorOption } from "./types";

const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;

/**
 * 예약 고치기 (F-5 항목·체어, F-6 할인율, F-8 메모) — PATCH /api/appointments/[id]. 바꾼 칸만 보낸다.
 * - 메모·할인율은 언제나, 항목·체어·담당자는 오늘 이후의 진행 중 예약만(서버도 같은 규칙).
 * - 상담실 예약을 일반 항목으로 바꾸면 진료 체어를 골라야 한다(상담실에는 고가 항목만).
 * - 의사(보기 전용)는 단가·할인·금액만 본다.
 */
export function AppointmentEditSection({
  data,
  settings,
  doctors,
  canWrite,
  canPrice,
  today,
  onSaved,
}: {
  data: AppointmentDetail;
  settings: ClinicSettings;
  doctors: DoctorOption[];
  canWrite: boolean;
  /** 금액 권한(appointment.price). 없으면 단가·할인율을 보여 주지도 보내지도 않는다 (S-3) */
  canPrice: boolean;
  today: string;
  onSaved: () => void;
}) {
  const counselors = useQuery({
    queryKey: ["staff", "COUNSELOR"],
    queryFn: () => apiFetch<{ staff: DoctorOption[] }>("/api/staff?role=COUNSELOR"),
    staleTime: 60_000,
    enabled: canWrite,
  });
  const [item, setItem] = useState(data.treatmentItem);
  const [chair, setChair] = useState(data.chair);
  const [doctorId, setDoctorId] = useState(data.doctorId ?? "");
  const [counselorId, setCounselorId] = useState(data.counselorId ?? "");
  const [discount, setDiscount] = useState(String(data.discountRate ?? 0));
  const [memo, setMemo] = useState(data.memo ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  const placementEditable =
    kstDateKey(new Date(data.startAt)) >= today && (SLOT_HOLDING_STATUSES as readonly string[]).includes(data.status);
  const itemChanged = item !== data.treatmentItem;
  // null = 단가 미입력 (S-3)
  const price = (itemChanged ? treatmentMetaOf(settings.treatmentItemMeta, item).price : data.listPrice) ?? null;
  const discountNumber = Number(discount);
  // 금액 권한이 없으면 할인율 칸이 없으므로 검사할 것도 없다
  const discountOk = !canPrice || (discount.trim() !== "" && isValidDiscountRate(discountNumber));
  const amount = canPrice && discountOk && price !== null ? amountAfterDiscount(price, discountNumber) : null;
  const chairKind = (code: string) => settings.chairs.find((c) => c.code === code)?.kind;
  const needsChair = chairKind(chair) === "CONSULT_ROOM" && !isPremiumItem(settings.treatmentItemMeta, item);

  const changes: Record<string, unknown> = {};
  if (itemChanged) changes.treatmentItem = item;
  if (chair !== data.chair) changes.chair = chair;
  if (doctorId !== (data.doctorId ?? "")) changes.doctorId = doctorId || null;
  if (counselorId !== (data.counselorId ?? "")) changes.counselorId = counselorId || null;
  if (canPrice && discountOk && discountNumber !== data.discountRate) changes.discountRate = discountNumber;
  if (memo.trim() !== (data.memo ?? "")) changes.memo = memo.trim() || null;
  const dirty = Object.keys(changes).length > 0;

  const save = useMutation({
    mutationFn: () => apiFetch(`/api/appointments/${data.id}`, { method: "PATCH", body: changes }),
    onSuccess: onSaved,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!discountOk) return setLocalError("할인율은 0~100 사이 정수(%)로 입력하세요.");
    if (needsChair) return setLocalError("일반 진료로 바꾸면 진료 체어를 골라야 합니다(상담실에는 고가 항목만).");
    if (containsResidentRegistrationNumber(memo)) return setLocalError(RRN_ERROR_MESSAGE);
    setLocalError(null);
    save.mutate();
  }

  const priceLine = (
    <p className="text-base text-slate-800">
      단가 {price === null ? "미입력" : won(price)}
      {discountOk && discountNumber > 0 && ` · 할인 ${discountNumber}%`}
      {amount !== null && <strong className="ml-1">→ 금액 {won(amount)}</strong>}
      <span className="ml-2 text-sm text-slate-500">(병원 기준 단가로 계산한 금액)</span>
    </p>
  );

  if (!canWrite) return null;

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3" aria-label="예약 고치기">
      <p className="text-base font-semibold text-slate-800">예약 고치기 — 바꾼 뒤 [예약 저장]</p>
      {placementEditable ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="edit-item">예약 항목</Label>
            <Select id="edit-item" value={item} onChange={(e) => setItem(e.target.value)}>
              {[...new Set([data.treatmentItem, ...settings.treatmentItems])].map((name) => (
                <option key={name} value={name}>
                  {name}
                  {isPremiumItem(settings.treatmentItemMeta, name) ? " (고가)" : ""}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="edit-chair">체어</Label>
            <Select id="edit-chair" value={chair} onChange={(e) => setChair(e.target.value)} aria-invalid={needsChair || undefined}>
              {settings.chairs.map((c) => (
                <option key={c.code} value={c.code} disabled={c.kind === "CONSULT_ROOM" && !isPremiumItem(settings.treatmentItemMeta, item)}>
                  {c.name} ({c.code})
                </option>
              ))}
            </Select>
            {needsChair && <FieldError>일반 진료는 상담실에 둘 수 없습니다. 진료 체어를 고르세요.</FieldError>}
          </div>
          <div>
            <Label htmlFor="edit-doctor">의사</Label>
            <Select id="edit-doctor" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">미지정</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="edit-counselor">상담자</Label>
            <Select id="edit-counselor" value={counselorId} onChange={(e) => setCounselorId(e.target.value)}>
              <option value="">미지정</option>
              {(counselors.data?.staff ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">지난 날이거나 처리가 끝난 예약은 {canPrice ? "메모와 할인율만" : "메모만"} 고칠 수 있습니다.</p>
      )}
      {canPrice && (
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="edit-discount">할인율(%)</Label>
          <Input
            id="edit-discount"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            step={1}
            className="w-28"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
          />
        </div>
        {priceLine}
      </div>
      )}
      <div>
        <Label htmlFor="edit-memo">메모</Label>
        <textarea
          id="edit-memo"
          rows={2}
          maxLength={1000}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          aria-describedby="edit-memo-guide"
          className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-blue-600 focus:outline-2 focus:outline-blue-200"
        />
        <p id="edit-memo-guide" className="mt-1 text-sm text-slate-500">
          {MEMO_GUIDE}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!dirty || save.isPending}>
          {save.isPending ? "저장 중…" : "예약 저장"}
        </Button>
        {localError && <FieldError>{localError}</FieldError>}
        {save.isError && (
          <FieldError>{save.error instanceof ApiRequestError ? save.error.message : "저장하지 못했습니다. 다시 시도하세요."}</FieldError>
        )}
      </div>
    </form>
  );
}
