"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/auth/api-client";
import type { ConsultOutcome } from "@/lib/domain/consult";
import type { ClinicSettings } from "@/lib/domain/clinic";
import { isPremiumItem } from "@/lib/domain/treatment";
import { addDays, formatKstDateLabel, formatKstTime, isValidDateKey, isValidTime, kstDateKey, kstDateTime } from "@/lib/time/kst";
import { Badge, Button, Dialog, FieldError, Input, Label, Select, Spinner } from "@/components/ui";
import type { ConsultItem, StaffOption } from "./consult-screen";

type Detail = ConsultItem & { content: string };

/**
 * 상담 상세 (F-10) — 내용 보기(조회는 감사 로그), 고치기(내용·관심 항목·결과·상담자), [→ 수술예약](T6-2).
 */
export function ConsultDetailDialog({
  id,
  canWrite,
  outcomes,
  counselors,
  doctors,
  settings,
  today,
  onClose,
  onChanged,
}: {
  id: string;
  canWrite: boolean;
  outcomes: ConsultOutcome[];
  counselors: StaffOption[];
  doctors: StaffOption[];
  settings: ClinicSettings;
  today: string;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const detail = useQuery({ queryKey: ["consultation", id], queryFn: () => apiFetch<{ consultation: Detail }>(`/api/consultations/${id}`), staleTime: 0 });
  return (
    <Dialog open onClose={onClose} title="상담 상세" className="max-w-2xl" footer={<Button variant="secondary" onClick={onClose}>닫기</Button>}>
      {detail.isPending ? (
        <Spinner showLabel />
      ) : detail.isError ? (
        <FieldError>{detail.error.message}</FieldError>
      ) : (
        <Body
          key={JSON.stringify(detail.data.consultation)}
          data={detail.data.consultation}
          canWrite={canWrite}
          outcomes={outcomes}
          counselors={counselors}
          doctors={doctors}
          settings={settings}
          today={today}
          onChanged={(message) => {
            onChanged(message);
            void detail.refetch();
          }}
        />
      )}
    </Dialog>
  );
}

function Body({
  data,
  canWrite,
  outcomes,
  counselors,
  doctors,
  settings,
  today,
  onChanged,
}: {
  data: Detail;
  canWrite: boolean;
  outcomes: ConsultOutcome[];
  counselors: StaffOption[];
  doctors: StaffOption[];
  settings: ClinicSettings;
  today: string;
  onChanged: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(data.content);
  const [outcome, setOutcome] = useState(data.outcome ?? outcomes[0]?.name ?? "");
  const [counselorId, setCounselorId] = useState(data.counselorId);
  const [booking, setBooking] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/api/consultations/${data.id}`, {
        method: "PATCH",
        body: {
          ...(content.trim() !== data.content ? { content: content.trim() } : {}),
          ...(outcome !== data.outcome ? { outcome } : {}),
          ...(counselorId !== data.counselorId ? { counselorId } : {}),
        },
      }),
    onSuccess: () => {
      setEditing(false);
      onChanged("상담을 저장했습니다.");
    },
  });
  const dirty = content.trim() !== data.content || outcome !== data.outcome || counselorId !== data.counselorId;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xl font-bold">{data.patientNameMasked}</span>
        {data.isNewPatient ? <Badge tone="warning">신환</Badge> : <Badge tone="neutral">구환</Badge>}
        <Badge tone="info">{data.outcome ?? "대기"}</Badge>
      </div>
      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-base">
        <dt className="text-slate-600">상담 일시</dt>
        <dd>{formatKstDateLabel(kstDateKey(new Date(data.consultedAt)))} {formatKstTime(new Date(data.consultedAt))}</dd>
        <dt className="text-slate-600">상담자</dt>
        <dd>{data.counselorName}</dd>
        <dt className="text-slate-600">관심 항목</dt>
        <dd>{data.interestedItems.join(", ") || "-"}</dd>
        <dt className="text-slate-600">수술예약</dt>
        <dd>
          {data.appointment
            ? `${formatKstDateLabel(kstDateKey(new Date(data.appointment.startAt)))} ${formatKstTime(new Date(data.appointment.startAt))} ${data.appointment.treatmentItem}`
            : "아직 없음"}
        </dd>
        <dt className="text-slate-600">상담 내용</dt>
        <dd className="whitespace-pre-wrap">{data.content}</dd>
      </dl>

      {canWrite && !editing && !booking && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setEditing(true)}>고치기</Button>
          {!data.appointment && <Button onClick={() => setBooking(true)}>→ 수술예약</Button>}
        </div>
      )}

      {editing && (
        <div className="flex flex-col gap-2 rounded-lg border-2 border-blue-200 p-3" aria-label="상담 고치기" role="form">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label htmlFor="consult-edit-outcome">결과</Label>
              <Select id="consult-edit-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                {outcomes.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="consult-edit-counselor">상담자</Label>
              <Select id="consult-edit-counselor" value={counselorId} onChange={(e) => setCounselorId(e.target.value)}>
                {counselors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="consult-edit-content">상담 내용</Label>
            <textarea id="consult-edit-content" rows={4} maxLength={4000} value={content} onChange={(e) => setContent(e.target.value)}
              className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-base" />
          </div>
          <div className="flex items-center gap-2">
            <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "저장 중…" : "상담 저장"}</Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>취소</Button>
            {save.isError && <FieldError>{save.error instanceof ApiRequestError ? save.error.message : "저장하지 못했습니다."}</FieldError>}
          </div>
        </div>
      )}

      {booking && (
        <SurgeryBookingForm
          consultationId={data.id}
          settings={settings}
          doctors={doctors}
          today={today}
          defaultItem={data.interestedItems.find((i) => isPremiumItem(settings.treatmentItemMeta, i))}
          onCancel={() => setBooking(false)}
          onBooked={() => {
            setBooking(false);
            onChanged("수술예약을 만들었습니다.");
          }}
        />
      )}
    </div>
  );
}

/** 상담 → 수술예약 (T6-2): 고가 항목만. 예약은 이 상담의 상담자로 잡힌다. */
function SurgeryBookingForm({
  consultationId,
  settings,
  doctors,
  today,
  defaultItem,
  onCancel,
  onBooked,
}: {
  consultationId: string;
  settings: ClinicSettings;
  doctors: StaffOption[];
  today: string;
  defaultItem?: string;
  onCancel: () => void;
  onBooked: () => void;
}) {
  const premium = settings.treatmentItems.filter((i) => isPremiumItem(settings.treatmentItemMeta, i) && i !== "상담");
  const [date, setDate] = useState(addDays(today, 7));
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState("60");
  const [chair, setChair] = useState(settings.chairs.find((c) => c.kind === "CHAIR")?.code ?? "");
  const [item, setItem] = useState(defaultItem && premium.includes(defaultItem) ? defaultItem : (premium[0] ?? ""));
  const [doctorId, setDoctorId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const book = useMutation({
    mutationFn: () =>
      apiFetch(`/api/consultations/${consultationId}/book`, {
        method: "POST",
        body: { startAt: kstDateTime(date, time).toISOString(), durationMin: Number(duration), chair, treatmentItem: item, doctorId: doctorId || null },
      }),
    onSuccess: onBooked,
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : "예약하지 못했습니다."),
  });

  return (
    <div className="flex flex-col gap-2 rounded-lg border-2 border-violet-300 p-3" role="form" aria-label="수술예약">
      <p className="font-semibold">수술예약 만들기</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <div><Label htmlFor="surgery-date">날짜</Label><Input id="surgery-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div><Label htmlFor="surgery-time">시각</Label><Input id="surgery-time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} /></div>
        <div>
          <Label htmlFor="surgery-duration">소요시간</Label>
          <Select id="surgery-duration" value={duration} onChange={(e) => setDuration(e.target.value)}>
            {[30, 60, 90, 120, 180].map((m) => <option key={m} value={m}>{m}분</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="surgery-item">수술 항목</Label>
          <Select id="surgery-item" value={item} onChange={(e) => setItem(e.target.value)}>
            {premium.map((i) => <option key={i} value={i}>{i}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="surgery-chair">체어</Label>
          <Select id="surgery-chair" value={chair} onChange={(e) => setChair(e.target.value)}>
            {settings.chairs.map((c) => <option key={c.code} value={c.code}>{c.group ? `${c.group} · ` : ""}{c.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="surgery-doctor">의사</Label>
          <Select id="surgery-doctor" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
            <option value="">미지정</option>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          disabled={book.isPending}
          onClick={() => {
            if (!isValidDateKey(date) || !isValidTime(time) || !item) return setError("날짜·시각·항목을 확인하세요.");
            setError(null);
            book.mutate();
          }}
        >
          {book.isPending ? "예약 중…" : "수술예약 저장"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>취소</Button>
        {error && <FieldError>{error}</FieldError>}
      </div>
    </div>
  );
}
