"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "@/lib/auth/api-client";
import { formatKstDateLabel, kstDateKey } from "@/lib/time/kst";
import { Button, Card, CardTitle, EmptyState, FieldError, Input, Label, Spinner, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { type Period, PERIOD_PRESETS, type PeriodPreset, periodError, presetPeriod } from "./period";

/** amount는 금액 권한(appointment.price)이 있을 때만 응답에 온다 (S-3) */
type Line = { item: string; patients: number; visits: number; amount?: number };
type Row = { staffId: string | null; staffName: string; patients: number; visits: number; amount?: number; items: Line[] };
type Report = { from: string; to: string; doctors: Row[]; counselors: Row[] };

const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;

/**
 * 의사·상담자 실적 (F-6) — GET /api/stats/performance. 내원한 예약만, 항목별 환자 수·방문 수·금액.
 * 금액은 병원 기준 단가 × (100 − 할인율)%의 합이다(실제 수납액이 아니다).
 */
export function PerformanceView() {
  const [today] = useState(() => kstDateKey(new Date()));
  const [preset, setPreset] = useState<PeriodPreset>("thisMonth");
  const [custom, setCustom] = useState<Period>(() => presetPeriod("thisMonth", today) as Period);
  const period = presetPeriod(preset, today) ?? custom;
  const error = periodError(period);

  const report = useQuery({
    queryKey: ["stats", "performance", period.from, period.to],
    queryFn: () => apiFetch<Report>(`/api/stats/performance?from=${period.from}&to=${period.to}`),
    enabled: error === null,
    placeholderData: keepPreviousData,
    staleTime: 0,
  });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold text-slate-900">진료 실적</h1>
        {report.data && (
          <p className="text-sm text-slate-600">
            {formatKstDateLabel(report.data.from)} ~ {formatKstDateLabel(report.data.to)}
          </p>
        )}
      </div>
      <Card className="flex flex-col gap-3">
        <fieldset>
          <legend className="mb-1 text-sm font-semibold text-slate-700">기간</legend>
          <div className="flex flex-wrap gap-1">
            {PERIOD_PRESETS.map((item) => (
              <Button
                key={item.key}
                variant={preset === item.key ? "primary" : "secondary"}
                aria-pressed={preset === item.key}
                onClick={() => {
                  if (item.key === "custom") setCustom(period);
                  setPreset(item.key);
                }}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </fieldset>
        {preset === "custom" && (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="perf-from">시작일</Label>
              <Input id="perf-from" type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="perf-to">종료일</Label>
              <Input id="perf-to" type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
            </div>
          </div>
        )}
        {error && <FieldError>{error}</FieldError>}
        <p className="text-sm text-slate-600">
          내원한 예약(내원·진료중·수납완료·귀가)만 셉니다. 금액은 예약 항목 단가 × (100 − 할인율)%의 합으로, 실제 수납액과 다를 수 있습니다.
        </p>
        {report.isFetching && <Spinner label="실적을 불러오는 중" showLabel />}
      </Card>

      {report.isError ? (
        <EmptyState title={report.error.message} action={<Button onClick={() => report.refetch()}>다시 시도</Button>} />
      ) : report.data ? (
        <>
          <PerformanceTable title="의사별 실적" rows={report.data.doctors} />
          <PerformanceTable title="상담자별 실적" rows={report.data.counselors} />
        </>
      ) : null}
    </div>
  );
}

function PerformanceTable({ title, rows }: { title: string; rows: Row[] }) {
  const showAmount = rows.some((row) => row.amount !== undefined);
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      {rows.length === 0 ? (
        <p className="text-base text-slate-500">이 기간에 내원한 예약이 없습니다.</p>
      ) : (
        <Table aria-label={title}>
          <THead>
            <Tr>
              <Th>담당자</Th>
              <Th>예약 항목</Th>
              <Th className="text-right">환자 수</Th>
              <Th className="text-right">방문 수</Th>
              {showAmount && <Th className="text-right">금액</Th>}
            </Tr>
          </THead>
          <TBody>
            {rows.flatMap((row) => [
              <Tr key={`${row.staffId}-total`} className="bg-slate-50 font-semibold">
                <Td>{row.staffName}</Td>
                <Td>합계</Td>
                <Td className="text-right tabular-nums">{row.patients}명</Td>
                <Td className="text-right tabular-nums">{row.visits}건</Td>
                {showAmount && <Td className="text-right tabular-nums">{won(row.amount ?? 0)}</Td>}
              </Tr>,
              ...row.items.map((line) => (
                <Tr key={`${row.staffId}-${line.item}`}>
                  <Td />
                  <Td>{line.item}</Td>
                  <Td className="text-right tabular-nums">{line.patients}명</Td>
                  <Td className="text-right tabular-nums">{line.visits}건</Td>
                  {showAmount && <Td className="text-right tabular-nums">{won(line.amount ?? 0)}</Td>}
                </Tr>
              )),
            ])}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
