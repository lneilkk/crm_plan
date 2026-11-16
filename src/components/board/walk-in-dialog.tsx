"use client";

import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/auth/api-client";
import type { ClinicSettings } from "@/lib/domain/clinic";
import { isPremiumItem } from "@/lib/domain/treatment";
import { PatientPicker, type SelectedPatient } from "@/components/patients/patient-picker";
import { useStaffOptions } from "@/components/shared/queries";
import { Button, Dialog, FieldError, Label, Select } from "@/components/ui";

const DURATIONS = [30, 60, 90] as const;

/**
 * [워크인 등록] — T5-5 (기획서 4-2). 예약 없이 온 고객을 검색하거나 이름·휴대폰으로 바로 등록하고, 체어·항목을 골라
 * [내원 처리]를 누르면 지금 시각 예약(채널 '워크인')이 만들어지고 바로 내원이 된다(POST /api/board/walk-in).
 */
export function WalkInDialog({
  settings,
  onDone,
  onClose,
}: {
  settings: ClinicSettings;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const doctors = useStaffOptions("DOCTOR");
  const chairs = settings.chairs.filter((c) => c.kind === "CHAIR");
  const [patient, setPatient] = useState<SelectedPatient | null>(null);
  const [chair, setChair] = useState(chairs[0]?.code ?? "");
  const [treatmentItem, setTreatmentItem] = useState(settings.treatmentItems.find((item) => !isPremiumItem(settings.treatmentItemMeta, item)) ?? settings.treatmentItems[0] ?? "");
  const [durationMin, setDurationMin] = useState<number>(30);
  const [doctorId, setDoctorId] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const register = useMutation({
    mutationFn: () =>
      apiFetch("/api/board/walk-in", {
        method: "POST",
        body: { patientId: patient!.id, chair, treatmentItem, durationMin, doctorId: doctorId || null },
      }),
    onSuccess: () => onDone("워크인 내원 처리했습니다."),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!patient) return setLocalError("고객을 고르거나 등록하세요.");
    setLocalError(null);
    register.mutate();
  }

  const serverError = register.error
    ? register.error instanceof ApiRequestError
      ? register.error.code === "CHAIR_CONFLICT"
        ? "지금 그 체어에 다른 예약이 있습니다. 다른 체어를 고르세요."
        : register.error.message
      : "등록하지 못했습니다. 다시 시도하세요."
    : null;

  return (
    <Dialog
      open
      onClose={onClose}
      title="워크인 등록"
      className="max-w-2xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            닫기
          </Button>
          <Button type="submit" form="walk-in-form" size="lg" disabled={register.isPending}>
            {register.isPending ? "처리 중…" : "내원 처리"}
          </Button>
        </>
      }
    >
      <form id="walk-in-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <p className="text-base text-slate-700">예약 없이 온 고객입니다. 지금 시각으로 워크인 예약을 만들고 바로 내원으로 기록합니다.</p>
        <PatientPicker selected={patient} onSelect={setPatient} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <Label htmlFor="walk-in-chair">체어</Label>
            <Select id="walk-in-chair" value={chair} onChange={(e) => setChair(e.target.value)}>
              {chairs.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="walk-in-item">예약 항목</Label>
            <Select id="walk-in-item" value={treatmentItem} onChange={(e) => setTreatmentItem(e.target.value)}>
              {settings.treatmentItems.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="walk-in-duration">소요시간</Label>
            <Select id="walk-in-duration" value={String(durationMin)} onChange={(e) => setDurationMin(Number(e.target.value))}>
              {DURATIONS.map((minutes) => (
                <option key={minutes} value={String(minutes)}>
                  {minutes}분
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="walk-in-doctor">의사</Label>
            <Select id="walk-in-doctor" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">미지정</option>
              {(doctors.data?.staff ?? []).map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {localError && <FieldError>{localError}</FieldError>}
        {serverError && <FieldError>{serverError}</FieldError>}
      </form>
    </Dialog>
  );
}
