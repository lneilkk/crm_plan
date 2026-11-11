"use client";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/auth/api-client";
import { APPOINTMENT_CHANNEL_LABEL, type AppointmentChannel } from "@/lib/domain/appointment";
import type { ClinicSettings } from "@/lib/domain/clinic";
import { maskName } from "@/lib/masking";
import { normalizePhone } from "@/lib/phone";
import { type DateKey, isValidDateKey, isValidTime, kstDateKey, kstDateTime } from "@/lib/time/kst";
import { containsResidentRegistrationNumber, MEMO_GUIDE, RRN_ERROR_MESSAGE } from "@/lib/validation/forbidden-text";
import type { DuplicatePatient, PatientListItem } from "@/server/patients/service";
import { Badge, Button, cn, Dialog, FieldError, Input, Label, Select, Spinner } from "@/components/ui";
import type { DoctorOption } from "./types";

/** 예약 화면에서 고를 수 있는 채널 — 워크인은 내원 보드에서만 등록한다 */
const BOOKING_CHANNELS = ["PHONE", "WEBSITE", "PLATFORM", "ONSITE"] as const satisfies readonly AppointmentChannel[];
const DURATION_PRESETS = [30, 60, 90] as const;
const SEARCH_DEBOUNCE_MS = 300;

export type BookingPrefill = { date: DateKey; time: string; chair?: string; doctorId?: string | null };

type SelectedPatient = { id: string; label: string };

/** 소요시간: 5~480분, 5분 단위 (서버 규칙과 같다) */
function isValidDuration(value: number): boolean {
  return Number.isInteger(value) && value >= 5 && value <= 480 && value % 5 === 0;
}

/**
 * 예약 등록 대화상자 — 빈 칸을 눌러 연다. 날짜·시각·체어(또는 의사)는 누른 칸으로 미리 채운다.
 * 고객은 검색(마스킹된 목록)으로 고르거나, 이름·휴대폰만으로 바로 등록한다.
 * 같은 체어·겹치는 시간이면(409 CHAIR_CONFLICT) 문구를 보이고 대화상자를 닫지 않는다.
 */
export function BookingDialog({
  prefill,
  settings,
  doctors,
  onClose,
  onCreated,
}: {
  prefill: BookingPrefill;
  settings: ClinicSettings;
  doctors: DoctorOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [patient, setPatient] = useState<SelectedPatient | null>(null);
  const [date, setDate] = useState(prefill.date);
  const [time, setTime] = useState(prefill.time);
  const [durationPreset, setDurationPreset] = useState<string>("30");
  const [customDuration, setCustomDuration] = useState("");
  const [doctorId, setDoctorId] = useState(prefill.doctorId ?? "");
  const [chair, setChair] = useState(prefill.chair ?? settings.chairs[0]?.code ?? "");
  const [treatmentItem, setTreatmentItem] = useState("");
  const [channel, setChannel] = useState<(typeof BOOKING_CHANNELS)[number]>("PHONE");
  const [memo, setMemo] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  const durationMin = durationPreset === "custom" ? Number(customDuration) : Number(durationPreset);

  const create = useMutation({
    mutationFn: () =>
      apiFetch("/api/appointments", {
        method: "POST",
        body: {
          patientId: patient!.id,
          startAt: kstDateTime(date, time).toISOString(),
          durationMin,
          doctorId: doctorId || null,
          chair,
          treatmentItem,
          channel,
          memo: memo.trim() || null,
        },
      }),
    onSuccess: onCreated,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const found: string[] = [];
    if (!patient) found.push("고객을 고르거나 새로 등록하세요.");
    if (!isValidDateKey(date)) found.push("날짜를 확인하세요.");
    else if (date < kstDateKey(new Date())) found.push("지난 날짜로는 예약할 수 없습니다.");
    if (!isValidTime(time) || Number(time.slice(3)) % 5 !== 0) found.push("시각은 5분 단위로 입력하세요 (예: 10:05).");
    if (!isValidDuration(durationMin)) found.push("소요시간은 5분 단위로 5~480분 사이로 입력하세요.");
    if (!chair) found.push("체어를 고르세요.");
    if (!treatmentItem) found.push("예약 항목을 고르세요.");
    if (containsResidentRegistrationNumber(memo)) found.push(RRN_ERROR_MESSAGE);
    setErrors(found);
    if (found.length === 0) create.mutate();
  }

  const serverError =
    create.error instanceof ApiRequestError
      ? create.error.code === "PATIENT_NOT_FOUND"
        ? "고객을 찾을 수 없습니다. 고객을 다시 고르세요."
        : create.error.message
      : create.error
        ? "예약을 등록하지 못했습니다. 다시 시도하세요."
        : null;

  return (
    <Dialog
      open
      onClose={onClose}
      title="예약 등록"
      className="max-w-2xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            닫기
          </Button>
          <Button type="submit" form="booking-form" size="lg" disabled={create.isPending}>
            {create.isPending ? "등록 중…" : "예약 등록"}
          </Button>
        </>
      }
    >
      <form id="booking-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <PatientPicker selected={patient} onSelect={setPatient} />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="booking-date">날짜</Label>
            <Input id="booking-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="booking-time">시각</Label>
            <Input id="booking-time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="booking-duration">소요시간</Label>
            <Select id="booking-duration" value={durationPreset} onChange={(e) => setDurationPreset(e.target.value)}>
              {DURATION_PRESETS.map((minutes) => (
                <option key={minutes} value={String(minutes)}>
                  {minutes}분
                </option>
              ))}
              <option value="custom">직접 입력</option>
            </Select>
            {durationPreset === "custom" && (
              <Input
                aria-label="소요시간(분) 직접 입력"
                type="number"
                min={5}
                max={480}
                step={5}
                inputMode="numeric"
                placeholder="분 (5분 단위)"
                className="mt-2"
                value={customDuration}
                onChange={(e) => setCustomDuration(e.target.value)}
              />
            )}
          </div>
          <div>
            <Label htmlFor="booking-chair">체어</Label>
            <Select id="booking-chair" value={chair} onChange={(e) => setChair(e.target.value)}>
              {settings.chairs.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="booking-doctor">의사</Label>
            <Select id="booking-doctor" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">미지정</option>
              {doctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="booking-item">예약 항목</Label>
            <Select id="booking-item" value={treatmentItem} onChange={(e) => setTreatmentItem(e.target.value)}>
              <option value="">선택하세요</option>
              {settings.treatmentItems.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <fieldset>
          <legend className="mb-1 text-sm font-semibold text-slate-700">예약 채널</legend>
          <div className="flex flex-wrap gap-2">
            {BOOKING_CHANNELS.map((value) => (
              <label
                key={value}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-base",
                  channel === value ? "border-blue-600 bg-blue-50 font-semibold" : "border-slate-300",
                )}
              >
                <input type="radio" name="booking-channel" value={value} checked={channel === value} onChange={() => setChannel(value)} />
                {APPOINTMENT_CHANNEL_LABEL[value]}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <Label htmlFor="booking-memo">메모</Label>
          <textarea
            id="booking-memo"
            rows={2}
            maxLength={1000}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            aria-describedby="booking-memo-guide"
            className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-blue-600 focus:outline-2 focus:outline-blue-200"
          />
          <p id="booking-memo-guide" className="mt-1 text-sm text-slate-500">
            {MEMO_GUIDE}
          </p>
        </div>

        {errors.map((message) => (
          <FieldError key={message}>{message}</FieldError>
        ))}
        {serverError && <FieldError className="text-base">{serverError}</FieldError>}
      </form>
    </Dialog>
  );
}

/** 고객 고르기: 검색 또는 이름·휴대폰으로 바로 등록 */
function PatientPicker({ selected, onSelect }: { selected: SelectedPatient | null; onSelect: (p: SelectedPatient | null) => void }) {
  const [mode, setMode] = useState<"search" | "new">("search");

  if (selected) {
    return (
      <div>
        <p className="mb-1 text-sm font-semibold text-slate-700">고객</p>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2">
          <span className="text-lg font-semibold" data-testid="booking-selected-patient">
            {selected.label}
          </span>
          <Button variant="secondary" onClick={() => onSelect(null)}>
            고객 바꾸기
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-700">고객</p>
        <Button variant="ghost" onClick={() => setMode(mode === "search" ? "new" : "search")}>
          {mode === "search" ? "신규 고객 등록" : "고객 검색으로"}
        </Button>
      </div>
      {mode === "search" ? <PatientSearchBox onSelect={onSelect} /> : <QuickPatientForm onSelect={onSelect} />}
    </div>
  );
}

function PatientSearchBox({ onSelect }: { onSelect: (p: SelectedPatient) => void }) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  // 검색어를 입력했을 때만 부른다(빈 검색은 최근 고객 목록이라 예약 등록에는 필요 없다).
  const result = useQuery({
    queryKey: ["patients", "search", query, 10],
    queryFn: () => apiFetch<{ items: PatientListItem[] }>(`/api/patients?q=${encodeURIComponent(query)}&limit=10`),
    enabled: query.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 0,
    gcTime: 60_000,
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          type="search"
          aria-label="고객 검색"
          placeholder="전화번호 뒷 4자리, 이름, 차트번호"
          autoComplete="off"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // 검색칸에서 Enter는 예약 등록이 아니라 검색이다.
            if (e.key === "Enter") e.preventDefault();
          }}
        />
        {result.isFetching && <Spinner label="검색 중" />}
      </div>
      {query.length > 0 && result.isError && <FieldError>{result.error.message}</FieldError>}
      {query.length > 0 && result.data && (
        result.data.items.length === 0 ? (
          <p className="text-base text-slate-600">검색 결과가 없습니다. 신규 고객이면 위의 &quot;신규 고객 등록&quot;을 누르세요.</p>
        ) : (
          <ul aria-label="고객 검색 결과" className="flex max-h-48 flex-col gap-1 overflow-y-auto">
            {result.data.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect({ id: item.id, label: `${item.nameMasked} · ${item.phoneMasked}` })}
                  className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-slate-200 px-3 text-left text-base hover:bg-blue-50"
                >
                  <span className="font-semibold">{item.nameMasked}</span>
                  <span className="tabular-nums text-slate-700">{item.phoneMasked}</span>
                  {item.birthYear && <span className="text-sm text-slate-500">{item.birthYear}년생</span>}
                  {item.dentwebChartNo && <span className="text-sm text-slate-500">차트 {item.dentwebChartNo}</span>}
                  {item.visitType === "NEW" && <Badge tone="warning">신규</Badge>}
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

/** 이름·휴대폰만으로 고객 등록. 같은 번호가 있으면(409) 기존 고객을 고르거나, 다른 사람임을 확인하고 등록한다. */
function QuickPatientForm({ onSelect }: { onSelect: (p: SelectedPatient) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicatePatient[] | null>(null);

  const register = useMutation({
    mutationFn: (confirmDuplicate: boolean) =>
      apiFetch<{ id: string }>("/api/patients", {
        method: "POST",
        body: { name: name.trim(), phone: phone.trim(), ...(confirmDuplicate ? { confirmDuplicate: true } : {}) },
      }),
    onSuccess: (data) => onSelect({ id: data.id, label: `${maskName(name)} (신규 등록)` }),
    onError: (error) => {
      if (error instanceof ApiRequestError && error.code === "DUPLICATE_PHONE") {
        setDuplicates((error.details?.duplicates as DuplicatePatient[] | undefined) ?? []);
      }
    },
  });

  function submit(confirmDuplicate: boolean) {
    if (!name.trim()) return setLocalError("이름을 입력하세요.");
    if (normalizePhone(phone) === null) return setLocalError("휴대폰 번호를 확인하세요 (예: 010-0123-4567).");
    setLocalError(null);
    register.mutate(confirmDuplicate);
  }

  const serverError =
    register.error && !(register.error instanceof ApiRequestError && register.error.code === "DUPLICATE_PHONE")
      ? register.error instanceof ApiRequestError && register.error.code === "VALIDATION_FAILED"
        ? "이름과 휴대폰 번호를 확인하세요."
        : register.error.message
      : null;

  return (
    <div
      className="flex flex-col gap-2"
      onKeyDown={(e) => {
        // 이름·휴대폰 칸에서 Enter는 예약 등록이 아니라 고객 등록이다.
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
          e.preventDefault();
          if (!duplicates) submit(false);
        }
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="quick-name">이름</Label>
          <Input
            id="quick-name"
            autoComplete="off"
            maxLength={50}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDuplicates(null);
            }}
          />
        </div>
        <div>
          <Label htmlFor="quick-phone">휴대폰</Label>
          <Input
            id="quick-phone"
            type="tel"
            autoComplete="off"
            placeholder="010-0123-4567"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setDuplicates(null);
            }}
          />
        </div>
      </div>
      {localError && <FieldError>{localError}</FieldError>}
      {serverError && <FieldError>{serverError}</FieldError>}

      {duplicates ? (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="mb-2 font-semibold text-amber-900">같은 번호로 등록된 고객이 있습니다. 같은 사람이면 그 고객을 고르세요.</p>
          <ul className="mb-2 flex flex-col gap-1">
            {duplicates.map((dup) => (
              <li key={dup.id}>
                <Button
                  variant="secondary"
                  className="w-full justify-start"
                  onClick={() => onSelect({ id: dup.id, label: `${dup.nameMasked}${dup.birthYear ? ` (${dup.birthYear}년생)` : ""}` })}
                >
                  {dup.nameMasked}
                  {dup.birthYear && <span className="text-sm text-slate-500">{dup.birthYear}년생</span>} — 이 고객으로 예약
                </Button>
              </li>
            ))}
          </ul>
          <Button variant="danger" onClick={() => submit(true)} disabled={register.isPending}>
            다른 사람입니다 — 새로 등록
          </Button>
        </div>
      ) : (
        <div>
          <Button onClick={() => submit(false)} disabled={register.isPending}>
            {register.isPending ? "등록 중…" : "고객 등록 후 선택"}
          </Button>
        </div>
      )}
    </div>
  );
}
