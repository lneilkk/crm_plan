"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch, ApiRequestError, type Me, ME_QUERY_KEY } from "@/lib/auth/api-client";
import { can } from "@/lib/auth/permissions";
import { APPOINTMENT_CHANNEL_LABEL } from "@/lib/domain/appointment";
import { fillBucketGaps, formatRate, type StatsUnit, type VisitStats } from "@/lib/stats/visit-stats";
import { formatKstDateLabel, kstDateKey } from "@/lib/time/kst";
import type { VisitReport } from "@/server/stats/visit-report";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  cn,
  EmptyState,
  FieldError,
  Input,
  Label,
  Spinner,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from "@/components/ui";
import { bucketLabel, type Period, periodError, PERIOD_PRESETS, type PeriodPreset, presetPeriod, STATS_UNITS } from "./period";
import { PerformanceView } from "./performance-view";
import { RateChart } from "./rate-chart";

/**
 * 통계 대시보드 — T7-2 (원장·관리자). 데이터는 GET /api/stats 한 번으로 읽는다.
 * 화면에는 개수와 비율만 있고, 환자를 알아볼 수 있는 값은 없다(API도 돌려주지 않는다).
 */
export function StatsDashboard() {
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: () => apiFetch<Me>("/api/auth/me"), staleTime: 60_000 });
  if (me.isPending) return <Spinner showLabel />;
  if (me.isError) {
    // 403(권한 없음)만 권한 안내로, 네트워크 오류·서버 오류는 다시 시도할 수 있게 보여 준다.
    if (me.error instanceof ApiRequestError && me.error.status === 403) return <NoPermission />;
    return <LoadError message={me.error instanceof ApiRequestError ? me.error.message : undefined} onRetry={() => me.refetch()} />;
  }
  if (!can(me.data.role, "stats.read")) return <NoPermission />;
  return <StatsTabs />;
}

/** 내원 통계 | 실적 (F-6) */
function StatsTabs() {
  const [tab, setTab] = useState<"visits" | "performance">("visits");
  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="통계 종류" className="mx-auto flex w-full max-w-6xl gap-1">
        {(
          [
            ["visits", "내원 통계"],
            ["performance", "실적"],
          ] as const
        ).map(([key, label]) => (
          <Button key={key} variant={tab === key ? "primary" : "secondary"} aria-pressed={tab === key} onClick={() => setTab(key)}>
            {label}
          </Button>
        ))}
      </div>
      {tab === "visits" ? <Dashboard /> : <PerformanceView />}
    </div>
  );
}

function LoadError({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4">
      <p className="text-red-800">{message ?? "통계 화면을 불러오지 못했습니다. 다시 시도하세요."}</p>
      <Button variant="secondary" onClick={onRetry}>
        다시 시도
      </Button>
    </div>
  );
}

function NoPermission() {
  return <EmptyState title="권한이 없습니다" description="통계는 원장과 관리자만 볼 수 있습니다." />;
}

function Dashboard() {
  // 오늘 날짜는 기간 버튼 계산에만 쓴다. 집계 기준 시각은 서버 시각이다.
  const [today] = useState(() => kstDateKey(new Date()));
  const [preset, setPreset] = useState<PeriodPreset>("thisMonth");
  const [custom, setCustom] = useState<Period>(() => presetPeriod("thisMonth", today) as Period);
  const [unit, setUnit] = useState<StatsUnit>("day");

  const period = presetPeriod(preset, today) ?? custom;
  const error = periodError(period);

  const stats = useQuery({
    queryKey: ["stats", period.from, period.to, unit],
    queryFn: () => apiFetch<VisitReport>(`/api/stats?from=${period.from}&to=${period.to}&unit=${unit}`),
    enabled: error === null,
    placeholderData: keepPreviousData,
    staleTime: 0,
  });

  function choosePreset(next: PeriodPreset) {
    // 직접 선택으로 바꾸면 지금 보던 기간에서 시작한다.
    if (next === "custom") setCustom(period);
    setPreset(next);
  }

  if (stats.error instanceof ApiRequestError && stats.error.status === 403) return <NoPermission />;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold text-slate-900">내원 통계</h1>
        {stats.data && (
          <p className="text-sm text-slate-600">
            {formatKstDateLabel(stats.data.range.from)} ~ {formatKstDateLabel(stats.data.range.to)} ({stats.data.range.days}일)
          </p>
        )}
      </div>

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-4">
          <fieldset>
            <legend className="mb-1 text-sm font-semibold text-slate-700">기간</legend>
            <div className="flex flex-wrap gap-1">
              {PERIOD_PRESETS.map((item) => (
                <Button
                  key={item.key}
                  variant={preset === item.key ? "primary" : "secondary"}
                  aria-pressed={preset === item.key}
                  onClick={() => choosePreset(item.key)}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-sm font-semibold text-slate-700">단위</legend>
            <div className="flex gap-1">
              {STATS_UNITS.map((item) => (
                <Button
                  key={item.key}
                  variant={unit === item.key ? "primary" : "secondary"}
                  aria-pressed={unit === item.key}
                  onClick={() => setUnit(item.key)}
                  className="min-w-12"
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </fieldset>
          {stats.isFetching && <Spinner label="통계를 불러오는 중" showLabel />}
        </div>
        {preset === "custom" && (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="stats-from">시작일</Label>
              <Input
                id="stats-from"
                type="date"
                value={custom.from}
                max={custom.to || undefined}
                onChange={(event) => setCustom({ ...custom, from: event.target.value })}
                aria-invalid={error !== null}
                aria-describedby={error ? "stats-period-error" : undefined}
              />
            </div>
            <span className="pb-3 text-slate-500">~</span>
            <div>
              <Label htmlFor="stats-to">종료일</Label>
              <Input
                id="stats-to"
                type="date"
                value={custom.to}
                min={custom.from || undefined}
                onChange={(event) => setCustom({ ...custom, to: event.target.value })}
                aria-invalid={error !== null}
                aria-describedby={error ? "stats-period-error" : undefined}
              />
            </div>
          </div>
        )}
        {error && <FieldError id="stats-period-error">{error}</FieldError>}
      </Card>

      {stats.isError && !(stats.error instanceof ApiRequestError && stats.error.status === 403) ? (
        <LoadError message={stats.error.message} onRetry={() => stats.refetch()} />
      ) : stats.data ? (
        <Report report={stats.data} stale={stats.isPlaceholderData} />
      ) : stats.isPending && error === null ? (
        <Spinner label="통계를 불러오는 중" showLabel />
      ) : null}
    </div>
  );
}

function Report({ report, stale }: { report: VisitReport; stale: boolean }) {
  const { total } = report;
  return (
    <div className={cn("flex flex-col gap-4 transition-opacity", stale && "opacity-60")} aria-busy={stale}>
      {total.unconfirmed > 0 && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-4">
          <Badge tone="warning">결과 미입력</Badge>
          <p className="text-base text-amber-950">
            <strong className="text-xl">미확인 {total.unconfirmed}건</strong> — 예약 시각이 지났는데 내원·노쇼·취소 결과가 입력되지
            않았습니다. 미확인은 유효 예약에 포함되므로 실내원율이 실제보다 낮게 보일 수 있습니다.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="실내원율" rate={total.arrivalRate} detail={`내원 ${total.arrived} / 유효 예약 ${total.booked}`} />
        <KpiTile label="노쇼율" rate={total.noShowRate} detail={`노쇼 ${total.noShow} / 유효 예약 ${total.booked}`} />
        <KpiTile
          label="당일취소율"
          rate={total.sameDayCancelRate}
          detail={`당일취소 ${total.sameDayCancel} / 유효 예약 ${total.booked}`}
        />
        <KpiTile label="지각률" rate={total.lateRate} detail={`지각내원 ${total.late} / 내원 ${total.arrived}`} />
      </div>
      <p className="text-sm text-slate-600">
        분모에서 뺀 예약: 사전취소 {total.advanceCancel}건 · 예약변경 {total.rescheduled}건 · 대기(아직 예약 시각 전){" "}
        {total.upcoming}건 · 지각 허용시간 {report.lateToleranceMin}분
      </p>

      <Card>
        <CardTitle>{STATS_UNITS.find((u) => u.key === report.unit)?.label}별 비율</CardTitle>
        {report.buckets.length === 0 ? (
          <EmptyState title="이 기간에는 예약이 없습니다" />
        ) : (
          <RateChart buckets={fillBucketGaps(report.buckets, report.range, report.unit)} unit={report.unit} />
        )}
      </Card>

      {report.buckets.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-bold text-slate-900">구간별 표</h2>
          <p className="text-sm text-slate-600">예약이 1건이라도 있는 구간만 보여 줍니다.</p>
          <StatsTable
            firstHeader="구간"
            rows={report.buckets.map((bucket) => ({ key: bucket.key, label: bucketLabel(bucket.key, report.unit), stats: bucket.stats }))}
            total={total}
          />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-bold text-slate-900">예약 채널별 실내원율 (워크인 포함)</h2>
        <StatsTable
          firstHeader="채널"
          rows={report.byChannel.map((item) => ({
            key: item.channel,
            label: APPOINTMENT_CHANNEL_LABEL[item.channel],
            stats: item.stats,
          }))}
          total={total}
        />
      </section>

      <Card>
        <CardTitle>설명</CardTitle>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          {report.definitions.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function KpiTile({ label, rate, detail }: { label: string; rate: number | null; detail: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <p className="text-base font-semibold text-slate-600">{label}</p>
      <p className="text-4xl font-bold tabular-nums text-slate-900">{formatRate(rate)}</p>
      <p className="text-sm tabular-nums text-slate-600">{detail}</p>
    </Card>
  );
}

const num = "text-right tabular-nums";

function StatsTable({
  firstHeader,
  rows,
  total,
}: {
  firstHeader: string;
  rows: { key: string; label: string; stats: VisitStats }[];
  total: VisitStats;
}) {
  const cells = (s: VisitStats) => (
    <>
      <Td className={num}>{s.booked}</Td>
      <Td className={num}>{s.arrived}</Td>
      <Td className={cn(num, "font-semibold")}>{formatRate(s.arrivalRate)}</Td>
      <Td className={num}>{s.noShow}</Td>
      <Td className={num}>{formatRate(s.noShowRate)}</Td>
      <Td className={num}>{s.sameDayCancel}</Td>
      <Td className={num}>{formatRate(s.sameDayCancelRate)}</Td>
      <Td className={num}>{s.late}</Td>
      <Td className={num}>{formatRate(s.lateRate)}</Td>
      <Td className={cn(num, s.unconfirmed > 0 && "font-bold text-amber-800")}>{s.unconfirmed}</Td>
      <Td className={num}>{s.advanceCancel}</Td>
      <Td className={num}>{s.rescheduled}</Td>
    </>
  );
  return (
    <Table>
      <THead>
        <tr>
          <Th>{firstHeader}</Th>
          <Th className={num}>유효 예약</Th>
          <Th className={num}>내원</Th>
          <Th className={num}>실내원율</Th>
          <Th className={num}>노쇼</Th>
          <Th className={num}>노쇼율</Th>
          <Th className={num}>당일취소</Th>
          <Th className={num}>당일취소율</Th>
          <Th className={num}>지각내원</Th>
          <Th className={num}>지각률</Th>
          <Th className={num}>미확인</Th>
          <Th className={num}>사전취소</Th>
          <Th className={num}>예약변경</Th>
        </tr>
      </THead>
      <TBody>
        {rows.map((row) => (
          <Tr key={row.key}>
            <Th scope="row" className="font-semibold">
              {row.label}
            </Th>
            {cells(row.stats)}
          </Tr>
        ))}
      </TBody>
      <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
        <tr>
          <Th scope="row">합계</Th>
          {cells(total)}
        </tr>
      </tfoot>
    </Table>
  );
}
