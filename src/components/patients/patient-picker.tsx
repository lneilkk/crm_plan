"use client";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/auth/api-client";
import { maskName } from "@/lib/masking";
import { normalizePhone } from "@/lib/phone";
import type { DuplicatePatient, PatientListItem } from "@/server/patients/service";
import { Badge, Button, FieldError, Input, Label, Spinner } from "@/components/ui";

/*
 * 고객 고르기 — 예약 등록(예약 캘린더)과 상담 등록이 함께 쓴다. S-6에서 booking-dialog.tsx에서 옮겼다(동작 같음).
 */

const SEARCH_DEBOUNCE_MS = 300;

export type SelectedPatient = { id: string; label: string };

/** 고객 고르기: 검색 또는 이름·휴대폰으로 바로 등록 */
export function PatientPicker({ selected, onSelect }: { selected: SelectedPatient | null; onSelect: (p: SelectedPatient | null) => void }) {
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
                  {item.isNewPatient ? <Badge tone="warning">신환</Badge> : <Badge tone="neutral">구환</Badge>}
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
    onSuccess: (data) => onSelect({ id: data.id, label: `${maskName(name)} (신환 등록)` }),
    onError: (error) => {
      if (error instanceof ApiRequestError && error.code === "DUPLICATE_PHONE") {
        setDuplicates((error.details?.duplicates as DuplicatePatient[] | undefined) ?? []);
      }
      // 이름·번호가 같은 고객이 이미 있으면(구환) 새로 만들지 않고 그 고객을 고른다 (F-4)
      if (error instanceof ApiRequestError && error.code === "EXISTING_PATIENT") {
        const existing = error.details?.existing as { id: string; nameMasked: string } | undefined;
        if (existing) onSelect({ id: existing.id, label: `${existing.nameMasked} (구환 — 이미 등록된 고객)` });
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
    register.error &&
    !(register.error instanceof ApiRequestError && ["DUPLICATE_PHONE", "EXISTING_PATIENT"].includes(register.error.code))
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
