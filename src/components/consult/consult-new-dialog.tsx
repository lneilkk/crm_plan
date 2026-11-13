"use client";

import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { apiFetch, ApiRequestError, type Me } from "@/lib/auth/api-client";
import { minutesToTime } from "@/lib/calendar/layout";
import type { ConsultOutcome } from "@/lib/domain/consult";
import type { ClinicSettings } from "@/lib/domain/clinic";
import { isPremiumItem } from "@/lib/domain/treatment";
import { type DateKey, isValidTime, kstDateTime, kstMinutesOfDay } from "@/lib/time/kst";
import { containsResidentRegistrationNumber, RRN_ERROR_MESSAGE } from "@/lib/validation/forbidden-text";
import { PatientPicker, type SelectedPatient } from "@/components/calendar/booking-dialog";
import { Button, Dialog, FieldError, Input, Label, Select } from "@/components/ui";
import type { StaffOption } from "./consult-screen";

/**
 * 상담 등록 (F-10, T6-1). 고객을 검색하거나 신환으로 바로 등록하고, 상담 내용·관심 항목·결과를 적는다.
 * 민감정보 동의 기록이 없는 고객은 '동의 받음'을 체크해야 저장된다(서버가 409 CONSENT_REQUIRED로 막는다).
 */
export function ConsultNewDialog({
  date,
  me,
  counselors,
  outcomes,
  settings,
  onClose,
  onCreated,
}: {
  date: DateKey;
  me: Me;
  counselors: StaffOption[];
  outcomes: ConsultOutcome[];
  settings: ClinicSettings;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [patient, setPatient] = useState<SelectedPatient | null>(null);
  const [counselorId, setCounselorId] = useState(counselors.some((c) => c.id === me.id) ? me.id : (counselors[0]?.id ?? ""));
  const [time, setTime] = useState(() => minutesToTime(Math.floor(kstMinutesOfDay(new Date()) / 5) * 5));
  const [items, setItems] = useState<string[]>([]);
  const [content, setContent] = useState("");
  const [outcome, setOutcome] = useState(outcomes[0]?.name ?? "");
  const [consent, setConsent] = useState(false);
  const [needConsent, setNeedConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const premium = settings.treatmentItems.filter((i) => isPremiumItem(settings.treatmentItemMeta, i));

  const save = useMutation({
    mutationFn: () =>
      apiFetch("/api/consultations", {
        method: "POST",
        body: {
          patientId: patient!.id,
          counselorId,
          consultedAt: kstDateTime(date, time).toISOString(),
          content: content.trim(),
          interestedItems: items,
          outcome: outcome || null,
          ...(consent ? { consentObtained: true } : {}),
        },
      }),
    onSuccess: onCreated,
    onError: (e) => {
      if (e instanceof ApiRequestError && e.code === "CONSENT_REQUIRED") setNeedConsent(true);
      setError(e instanceof ApiRequestError ? e.message : "저장하지 못했습니다.");
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!patient) return setError("고객을 고르세요.");
    if (!counselorId) return setError("상담자를 고르세요.");
    if (!isValidTime(time)) return setError("시각을 확인하세요.");
    if (!content.trim()) return setError("상담 내용을 적으세요.");
    if (containsResidentRegistrationNumber(content)) return setError(RRN_ERROR_MESSAGE);
    setError(null);
    save.mutate();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="상담 등록"
      className="max-w-2xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>닫기</Button>
          <Button type="submit" form="consult-new" disabled={save.isPending}>{save.isPending ? "저장 중…" : "상담 저장"}</Button>
        </>
      }
    >
      <form id="consult-new" onSubmit={submit} className="flex flex-col gap-3">
        <PatientPicker selected={patient} onSelect={setPatient} />
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="consult-counselor">상담자</Label>
            <Select id="consult-counselor" value={counselorId} onChange={(e) => setCounselorId(e.target.value)}>
              {counselors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="consult-time">시각</Label>
            <Input id="consult-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="consult-outcome">결과</Label>
            <Select id="consult-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              {outcomes.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
            </Select>
          </div>
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-semibold text-slate-700">관심 항목</legend>
          <div className="flex flex-wrap gap-1.5">
            {premium.map((item) => {
              const on = items.includes(item);
              return (
                <button key={item} type="button" aria-pressed={on} onClick={() => setItems(on ? items.filter((i) => i !== item) : [...items, item])}
                  className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${on ? "border-blue-700 bg-blue-700 text-white" : "border-slate-300 bg-white"}`}>
                  {item}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div>
          <Label htmlFor="consult-content">상담 내용</Label>
          <textarea id="consult-content" rows={4} maxLength={4000} value={content} onChange={(e) => setContent(e.target.value)}
            className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-blue-600 focus:outline-2 focus:outline-blue-200" />
          <p className="mt-1 text-sm text-slate-500">상담 내용은 민감정보입니다. 주민등록번호·진단명·처방은 적지 마세요.</p>
        </div>
        <label className={`flex min-h-11 items-center gap-2 rounded-lg p-2 ${needConsent ? "bg-amber-50 ring-2 ring-amber-400" : ""}`}>
          <input type="checkbox" className="size-5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          이 고객에게 민감정보(상담 내용) 처리 동의를 받았습니다
        </label>
        {error && <FieldError>{error}</FieldError>}
      </form>
    </Dialog>
  );
}
