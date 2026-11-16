"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/auth/api-client";
import { isPendingStatus, type VisitReasonCode } from "@/lib/domain/appointment";
import type { Chair } from "@/lib/domain/clinic";
import { type DateKey, formatKstShortDate, formatKstTime, kstDateKey } from "@/lib/time/kst";
import { useAccess } from "@/components/auth/access";
import { ReasonDialog } from "@/components/board/reason-dialog";
import { RescheduleDialog, type RescheduleValues } from "@/components/board/reschedule-dialog";
import { Button, FieldError } from "@/components/ui";
import type { AppointmentDetail } from "./types";

/**
 * 예약 상세의 [예약변경]·[취소] — T4-3. 내원 보드는 오늘 예약만 보이므로, 앞날 예약은 여기서 바꾸거나 취소한다.
 * - 취소: 예약일 전이면 사전취소(사유 없음, 확인 한 번), 예약 당일이면 당일취소(사유 필수). 서버도 날짜로 다시 확인한다.
 * - 예약변경: 새 일시로 새 예약을 만들고 원 예약은 '예약변경'이 된다(원 예약 ID 연결). 고객 상세에서 이어서 보인다.
 * 대기 상태(예약확정·확인완료)이고 오늘 이후 예약에서만 보인다. 지난 날 예약 정리는 내원 보드·일 마감(T5-6)의 일이다.
 */
export function AppointmentActions({
  data,
  chairs,
  today,
  onDone,
}: {
  data: AppointmentDetail;
  chairs: Chair[];
  today: DateKey;
  onDone: (message: string) => Promise<void> | void;
}) {
  const { allows } = useAccess();
  const [mode, setMode] = useState<"none" | "advance" | "reason" | "reschedule">("none");
  const start = new Date(data.startAt);
  const day = kstDateKey(start);
  const advance = day > today;

  const cancel = useMutation({
    mutationFn: (reasonCode: VisitReasonCode | null) =>
      apiFetch(`/api/appointments/${data.id}/status`, {
        method: "POST",
        body: { to: advance ? "CANCELED_ADVANCE" : "CANCELED_SAME_DAY", reasonCode, expectedStatus: data.status },
      }),
    onSuccess: async () => {
      setMode("none");
      await onDone(advance ? "사전취소로 기록했습니다." : "당일취소로 기록했습니다.");
    },
  });
  const reschedule = useMutation({
    mutationFn: (values: RescheduleValues) =>
      apiFetch(`/api/appointments/${data.id}/reschedule`, {
        method: "POST",
        body: { startAt: values.startAt.toISOString(), chair: values.chair, durationMin: values.durationMin, expectedStatus: data.status },
      }),
    onSuccess: async (_result, values) => {
      setMode("none");
      await onDone(`${formatKstShortDate(kstDateKey(values.startAt))} ${formatKstTime(values.startAt)}(으)로 예약을 변경했습니다.`);
    },
  });

  const canReschedule = allows("appointment.reschedule");
  const canCancel = allows("appointment.cancel");
  if (!isPendingStatus(data.status) || day < today || (!canReschedule && !canCancel)) return null;
  const busy = cancel.isPending || reschedule.isPending;

  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="예약 변경·취소" className="flex flex-wrap gap-2">
        {canReschedule && (
          <Button variant="secondary" disabled={busy} onClick={() => setMode("reschedule")}>
            예약변경
          </Button>
        )}
        {canCancel && (
          <Button variant="secondary" className="text-red-700" disabled={busy} onClick={() => setMode(advance ? "advance" : "reason")}>
            취소
          </Button>
        )}
      </div>
      {mode === "advance" && (
        <div role="alertdialog" aria-label="사전취소 확인" className="rounded-lg border-2 border-amber-400 bg-amber-50 p-3">
          <p className="font-semibold text-amber-900">예약일 전이라 사전취소로 기록합니다. 사유는 필요 없습니다.</p>
          <div className="mt-2 flex gap-2">
            <Button className="bg-red-700 hover:bg-red-800" disabled={busy} onClick={() => cancel.mutate(null)}>
              {cancel.isPending ? "기록 중…" : "사전취소로 기록"}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setMode("none")}>
              닫기
            </Button>
          </div>
        </div>
      )}
      {cancel.isError && <FieldError>{cancel.error instanceof ApiRequestError ? cancel.error.message : "취소하지 못했습니다."}</FieldError>}
      {mode === "reason" && (
        <ReasonDialog
          title={`당일취소 사유 · ${data.patientNameMasked} (${formatKstTime(start)})`}
          onClose={() => setMode("none")}
          onPick={(reason) => cancel.mutate(reason)}
        />
      )}
      {mode === "reschedule" && (
        <RescheduleDialog
          row={{ startAt: data.startAt, time: formatKstTime(start), chair: data.chair, durationMin: data.durationMin, nameMasked: data.patientNameMasked }}
          chairs={chairs}
          pending={reschedule.isPending}
          error={reschedule.error}
          onSubmit={(values) => reschedule.mutate(values)}
          onClose={() => {
            reschedule.reset();
            setMode("none");
          }}
        />
      )}
    </div>
  );
}
