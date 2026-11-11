"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/auth/api-client";
import {
  GENDER_LABEL,
  GENDERS,
  type Gender,
  REFERRAL_SOURCE_LABEL,
  REFERRAL_SOURCES,
  type ReferralSource,
  VISIT_TYPE_LABEL,
  VISIT_TYPES,
  type VisitType,
} from "@/lib/domain/patient";
import { normalizePhone } from "@/lib/phone";
import type { DuplicatePatient, PatientDetail } from "@/server/patients/service";
import { Button, Card, cn, FieldError, Input, Label, Select } from "@/components/ui";

type FieldName = "name" | "phone" | "birthDate" | "dentwebChartNo" | "tags" | "memo";

const FIELD_MESSAGE: Record<FieldName, string> = {
  name: "이름을 입력하세요 (50자 이하).",
  phone: "휴대폰 번호를 확인하세요 (예: 010-0123-4567).",
  birthDate: "생년월일을 확인하세요.",
  dentwebChartNo: "차트번호는 30자 이하로 입력하세요.",
  tags: "태그는 10개까지, 각 20자 이하로 입력하세요.",
  memo: "메모는 1000자 이하로 입력하세요.",
};

type FormValues = {
  name: string;
  phone: string;
  birthDate: string;
  gender: Gender | "";
  visitType: VisitType;
  referralSource: ReferralSource | "";
  dentwebChartNo: string;
  tags: string;
  memo: string;
};

function initialValues(patient?: PatientDetail): FormValues {
  return {
    name: patient?.name ?? "",
    phone: patient?.phone ?? "",
    birthDate: patient?.birthDate ?? "",
    gender: patient?.gender ?? "",
    visitType: patient?.visitType ?? "NEW",
    referralSource: patient?.referralSource ?? "",
    dentwebChartNo: patient?.dentwebChartNo ?? "",
    tags: patient?.tags.join(", ") ?? "",
    memo: patient?.memo ?? "",
  };
}

function toBody(values: FormValues, confirmDuplicate: boolean) {
  return {
    name: values.name.trim(),
    phone: values.phone.trim(),
    birthDate: values.birthDate || null,
    gender: values.gender || null,
    visitType: values.visitType,
    referralSource: values.referralSource || null,
    dentwebChartNo: values.dentwebChartNo.trim() || null,
    tags: values.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    memo: values.memo.trim() || null,
    ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
  };
}

/** 브라우저에서 먼저 확인하는 것: 이름·번호 형식. 나머지는 서버가 검증한다. */
function localErrors(values: FormValues): FieldName[] {
  const errors: FieldName[] = [];
  if (!values.name.trim()) errors.push("name");
  if (!normalizePhone(values.phone)) errors.push("phone");
  return errors;
}

/**
 * 고객 등록·수정 폼 — T3-1. patient가 없으면 등록(POST), 있으면 수정(PATCH).
 * 같은 번호의 고객이 있으면(409 DUPLICATE_PHONE) 마스킹한 목록을 보여 주고 "그래도 등록"으로 다시 보낸다.
 */
export function PatientForm({ patient, onDone }: { patient?: PatientDetail; onDone?: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const editing = patient !== undefined;
  const [values, setValues] = useState<FormValues>(() => initialValues(patient));
  const [fieldErrors, setFieldErrors] = useState<FieldName[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicatePatient[] | null>(null);

  const save = useMutation({
    mutationFn: (confirmDuplicate: boolean) =>
      editing
        ? apiFetch<{ id: string }>(`/api/patients/${patient.id}`, { method: "PATCH", body: toBody(values, confirmDuplicate) })
        : apiFetch<{ id: string }>("/api/patients", { method: "POST", body: toBody(values, confirmDuplicate) }),
    onSuccess: async ({ id }) => {
      setDuplicates(null);
      await queryClient.invalidateQueries({ queryKey: ["patients"] });
      if (editing) onDone?.();
      else router.push(`/patients/${id}`);
    },
    onError: (error) => {
      if (!(error instanceof ApiRequestError)) return;
      if (error.code === "DUPLICATE_PHONE") {
        setDuplicates((error.details?.duplicates as DuplicatePatient[] | undefined) ?? []);
      } else if (error.code === "VALIDATION_FAILED") {
        const fields = (error.details?.fields as { path: string }[] | undefined) ?? [];
        setFieldErrors(
          [...new Set(fields.map((field) => field.path.split(".")[0]))].filter((path): path is FieldName => path in FIELD_MESSAGE),
        );
      }
    },
  });

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    if (key === "phone") setDuplicates(null);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = localErrors(values);
    setFieldErrors(errors);
    if (errors.length === 0) save.mutate(false);
  }

  const hasError = (field: FieldName) => fieldErrors.includes(field);
  const errorProps = (field: FieldName) =>
    hasError(field) ? { "aria-invalid": true, "aria-describedby": `${field}-error` } : {};
  const error = (field: FieldName) =>
    hasError(field) && <FieldError id={`${field}-error`}>{FIELD_MESSAGE[field]}</FieldError>;
  const otherError =
    save.isError && !(save.error instanceof ApiRequestError && ["DUPLICATE_PHONE", "VALIDATION_FAILED"].includes(save.error.code));

  return (
    <Card className="p-6">
      <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="name">이름 *</Label>
          <Input id="name" autoComplete="off" value={values.name} onChange={(e) => set("name", e.target.value)} {...errorProps("name")} />
          {error("name")}
        </div>
        <div>
          <Label htmlFor="phone">휴대폰 *</Label>
          <Input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="010-0000-0000"
            value={values.phone}
            onChange={(e) => set("phone", e.target.value)}
            {...errorProps("phone")}
          />
          {error("phone")}
        </div>
        <div>
          <Label htmlFor="birthDate">생년월일</Label>
          <Input
            id="birthDate"
            type="date"
            value={values.birthDate}
            onChange={(e) => set("birthDate", e.target.value)}
            {...errorProps("birthDate")}
          />
          {error("birthDate")}
        </div>
        <div>
          <Label htmlFor="gender">성별</Label>
          <Select id="gender" value={values.gender} onChange={(e) => set("gender", e.target.value as Gender | "")}>
            <option value="">선택 안 함</option>
            {GENDERS.map((g) => (
              <option key={g} value={g}>
                {GENDER_LABEL[g]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="dentwebChartNo">덴트웹 차트번호</Label>
          <Input
            id="dentwebChartNo"
            autoComplete="off"
            value={values.dentwebChartNo}
            onChange={(e) => set("dentwebChartNo", e.target.value)}
            {...errorProps("dentwebChartNo")}
          />
          {error("dentwebChartNo")}
        </div>
        <div>
          <Label htmlFor="referralSource">유입경로</Label>
          <Select
            id="referralSource"
            value={values.referralSource}
            onChange={(e) => set("referralSource", e.target.value as ReferralSource | "")}
          >
            <option value="">선택 안 함</option>
            {REFERRAL_SOURCES.map((r) => (
              <option key={r} value={r}>
                {REFERRAL_SOURCE_LABEL[r]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="visitType">신규/재진</Label>
          <Select id="visitType" value={values.visitType} onChange={(e) => set("visitType", e.target.value as VisitType)}>
            {VISIT_TYPES.map((v) => (
              <option key={v} value={v}>
                {VISIT_TYPE_LABEL[v]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="tags">태그 (쉼표로 구분)</Label>
          <Input
            id="tags"
            autoComplete="off"
            placeholder="예: VIP, 소개고객"
            value={values.tags}
            onChange={(e) => set("tags", e.target.value)}
            {...errorProps("tags")}
          />
          {error("tags")}
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="memo">메모</Label>
          <textarea
            id="memo"
            rows={3}
            className={cn(
              "block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900",
              "focus:border-blue-600 focus:outline-2 focus:outline-blue-200 aria-invalid:border-red-600",
            )}
            value={values.memo}
            onChange={(e) => set("memo", e.target.value)}
            {...errorProps("memo")}
          />
          {error("memo")}
          <p className="mt-1 text-sm text-slate-500">진단·처방 같은 진료 내용은 적지 않습니다.</p>
        </div>

        {duplicates && (
          <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 sm:col-span-2">
            <p className="text-lg font-bold text-amber-900">같은 번호로 등록된 고객이 있습니다</p>
            <p className="mt-1 text-amber-900">
              같은 사람이면 기존 고객을 쓰세요. 가족처럼 다른 사람이 번호를 함께 쓰면 그대로 {editing ? "저장" : "등록"}할 수 있습니다.
            </p>
            <ul className="mt-3 flex flex-col gap-1">
              {duplicates.map((d) => (
                <li key={d.id}>
                  <Link href={`/patients/${d.id}`} target="_blank" className="font-semibold text-blue-800 underline">
                    {d.nameMasked}
                  </Link>{" "}
                  <span className="text-slate-700">{d.birthYear ? `${d.birthYear}년생` : "생년 미입력"}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="danger" disabled={save.isPending} onClick={() => save.mutate(true)}>
                {editing ? "그래도 저장" : "그래도 등록"}
              </Button>
              <Button variant="secondary" onClick={() => setDuplicates(null)}>
                취소
              </Button>
            </div>
          </div>
        )}

        {otherError && <FieldError className="sm:col-span-2">{save.error?.message}</FieldError>}

        {!duplicates && (
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button type="submit" size="lg" disabled={save.isPending}>
              {save.isPending ? "저장 중…" : editing ? "저장" : "등록"}
            </Button>
            <Button variant="secondary" size="lg" onClick={() => (onDone ? onDone() : router.back())}>
              취소
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}
