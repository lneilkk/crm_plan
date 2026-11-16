"use client";

import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/auth/api-client";
import { APPOINTMENT_CHANNEL_LABEL, type AppointmentChannel } from "@/lib/domain/appointment";
import type { ClinicSettings } from "@/lib/domain/clinic";
import { isPremiumItem } from "@/lib/domain/treatment";
import { type DateKey, isValidDateKey, isValidTime, kstDateKey, kstDateTime } from "@/lib/time/kst";
import { containsResidentRegistrationNumber, MEMO_GUIDE, RRN_ERROR_MESSAGE } from "@/lib/validation/forbidden-text";
import { Button, cn, Dialog, FieldError, Input, Label, Select } from "@/components/ui";
import { type CalendarStyle, LabelPicker } from "./calendar-style";
import type { DoctorOption } from "./types";
import { useStaffOptions } from "@/components/shared/queries";
import { PatientPicker, type SelectedPatient } from "@/components/patients/patient-picker";

/** 예약 화면에서 고를 수 있는 채널 — 워크인은 내원 보드에서만 등록한다 */
const BOOKING_CHANNELS = ["PHONE", "WEBSITE", "PLATFORM", "ONSITE"] as const satisfies readonly AppointmentChannel[];
const DURATION_PRESETS = [30, 60, 90] as const;

export type BookingPrefill = { date: DateKey; time: string; chair?: string; doctorId?: string | null };

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
  style,
  onClose,
  onCreated,
}: {
  prefill: BookingPrefill;
  settings: ClinicSettings;
  doctors: DoctorOption[];
  /** 색 라벨 (F-2) */
  style: CalendarStyle;
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
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [counselorId, setCounselorId] = useState("");
  const counselors = useStaffOptions("COUNSELOR");
  // 상담실에는 고가(상담 대상) 항목만 (F-5)
  const inConsultRoom = settings.chairs.find((c) => c.code === chair)?.kind === "CONSULT_ROOM";
  const itemChoices = settings.treatmentItems.filter((item) => !inConsultRoom || isPremiumItem(settings.treatmentItemMeta, item));
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
          counselorId: counselorId || null,
          chair,
          treatmentItem,
          channel,
          memo: memo.trim() || null,
          ...(labelIds.length > 0 ? { labelIds } : {}),
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
            <Select
              id="booking-chair"
              value={chair}
              onChange={(e) => {
                const next = e.target.value;
                setChair(next);
                // 상담실로 바꿨는데 일반 항목이 골라져 있으면 항목을 비운다
                if (settings.chairs.find((c) => c.code === next)?.kind === "CONSULT_ROOM" && treatmentItem && !isPremiumItem(settings.treatmentItemMeta, treatmentItem)) {
                  setTreatmentItem("");
                }
              }}
            >
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
              {itemChoices.map((item) => (
                <option key={item} value={item}>
                  {item}
                  {isPremiumItem(settings.treatmentItemMeta, item) ? " (고가)" : ""}
                </option>
              ))}
            </Select>
            {inConsultRoom && <p className="mt-1 text-sm text-slate-500">상담실에는 고가(상담 대상) 항목만 넣을 수 있습니다.</p>}
          </div>
          <div>
            <Label htmlFor="booking-counselor">상담자</Label>
            <Select id="booking-counselor" value={counselorId} onChange={(e) => setCounselorId(e.target.value)}>
              <option value="">미지정</option>
              {(counselors.data?.staff ?? []).map((staff) => (
                <option key={staff.id} value={staff.id}>
                  {staff.name}
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
          <p id="booking-labels-title" className="mb-1 text-base font-semibold text-slate-800">
            색 라벨 <span className="text-sm font-normal text-slate-500">(여러 개 고를 수 있음)</span>
          </p>
          <LabelPicker style={style} value={labelIds} onChange={setLabelIds} idPrefix="booking" />
        </div>

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
