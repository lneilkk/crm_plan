"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { apiFetch } from "@/lib/auth/api-client";
import { APPOINTMENT_STATUS_LABEL } from "@/lib/domain/appointment";
import { GENDER_LABEL, REFERRAL_SOURCE_LABEL, VISIT_TYPE_LABEL } from "@/lib/domain/patient";
import { formatKstDateLabel, formatKstTime, kstDateKey } from "@/lib/time/kst";
import type { PatientAppointmentItem, PatientDetail as Detail } from "@/server/patients/service";
import { Badge, Button, Card, CardTitle, EmptyState, Spinner, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { PatientForm } from "./patient-form";

type DetailResponse = { patient: Detail; appointments: PatientAppointmentItem[] };

/** 고객 상세 — 전체 정보와 예약 이력. "수정"을 누르면 같은 자리에서 등록 폼으로 고친다. */
export function PatientDetail({ id }: { id: string }) {
  const [editing, setEditing] = useState(false);
  const detail = useQuery({
    queryKey: ["patients", "detail", id],
    queryFn: () => apiFetch<DetailResponse>(`/api/patients/${encodeURIComponent(id)}`),
    staleTime: 0,
    gcTime: 0,
  });

  if (detail.isPending) return <Spinner showLabel label="불러오는 중" />;
  if (detail.isError) {
    return (
      <EmptyState
        title={detail.error.message}
        action={
          <Link href="/patients" className="font-semibold text-blue-800 underline">
            고객 목록으로
          </Link>
        }
      />
    );
  }

  const { patient, appointments } = detail.data;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/patients" className="text-blue-800 underline">
            고객 목록
          </Link>
          <h1 className="text-2xl font-bold text-slate-900">{patient.name}</h1>
          <Badge tone={patient.visitType === "NEW" ? "info" : "neutral"}>{VISIT_TYPE_LABEL[patient.visitType]}</Badge>
          {patient.noShowCount > 0 && <Badge tone="danger">노쇼 {patient.noShowCount}회</Badge>}
        </div>
        {!editing && (
          <Button size="lg" variant="secondary" onClick={() => setEditing(true)}>
            수정
          </Button>
        )}
      </div>

      {editing ? (
        <PatientForm key={patient.updatedAt} patient={patient} onDone={() => setEditing(false)} />
      ) : (
        <Card>
          <dl className="grid gap-x-6 gap-y-3 text-base sm:grid-cols-2">
            <Item label="휴대폰" value={patient.phone} />
            <Item label="생년월일" value={patient.birthDate ?? "-"} />
            <Item label="성별" value={patient.gender ? GENDER_LABEL[patient.gender] : "-"} />
            <Item label="덴트웹 차트번호" value={patient.dentwebChartNo ?? "-"} />
            <Item label="유입경로" value={patient.referralSource ? REFERRAL_SOURCE_LABEL[patient.referralSource] : "-"} />
            <div>
              <dt className="text-sm font-semibold text-slate-600">태그</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {patient.tags.length === 0
                  ? "-"
                  : patient.tags.map((tag) => (
                      <Badge key={tag} tone="muted">
                        {tag}
                      </Badge>
                    ))}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-sm font-semibold text-slate-600">메모</dt>
              <dd className="mt-1 whitespace-pre-wrap">{patient.memo ?? "-"}</dd>
            </div>
          </dl>
        </Card>
      )}

      <Card>
        <CardTitle>예약 이력</CardTitle>
        {appointments.length === 0 ? (
          <p className="text-slate-600">예약 이력이 없습니다.</p>
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>일시</Th>
                <Th>예약 항목</Th>
                <Th>체어</Th>
                <Th>상태</Th>
              </tr>
            </THead>
            <TBody>
              {appointments.map((a) => {
                const start = new Date(a.startAt);
                return (
                  <Tr key={a.id}>
                    <Td className="tabular-nums">
                      {formatKstDateLabel(kstDateKey(start))} {formatKstTime(start)}
                    </Td>
                    <Td>{a.treatmentItem}</Td>
                    <Td>{a.chair}</Td>
                    <Td>
                      <Badge>{APPOINTMENT_STATUS_LABEL[a.status]}</Badge>
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm font-semibold text-slate-600">{label}</dt>
      <dd className="mt-1 tabular-nums">{value}</dd>
    </div>
  );
}
