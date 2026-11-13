"use client";

import { useState } from "react";
import { formatRate, type StatsUnit, type VisitBucket, type VisitStats } from "@/lib/stats/visit-stats";
import { bucketLabel } from "./period";

type RateKey = "arrivalRate" | "noShowRate" | "sameDayCancelRate" | "lateRate";
type Marker = "circle" | "square" | "triangle" | "diamond";

/**
 * 네 비율의 선 색·선 모양·점 모양. 색을 구분하기 어려워도 선 모양(실선·파선·점선·일점쇄선)과
 * 점 모양(원·네모·세모·마름모), 범례 글자로 구분된다. 색은 색각 이상 검사를 통과한 순서(파랑·주황·청록·노랑).
 */
export const RATE_SERIES: { key: RateKey; label: string; color: string; dash: string; marker: Marker }[] = [
  { key: "arrivalRate", label: "실내원율", color: "#2a78d6", dash: "", marker: "circle" },
  { key: "noShowRate", label: "노쇼율", color: "#eb6834", dash: "7 4", marker: "square" },
  { key: "sameDayCancelRate", label: "당일취소율", color: "#1baf7a", dash: "2 3", marker: "triangle" },
  { key: "lateRate", label: "지각률", color: "#eda100", dash: "9 3 2 3", marker: "diamond" },
];

const W = 720;
const H = 260;
const M = { left: 48, right: 16, top: 12, bottom: 32 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;
const Y_TICKS = [0, 0.25, 0.5, 0.75, 1];
/** 구간이 이보다 많으면 점을 그리지 않는다(선만) */
const MAX_MARKED_POINTS = 31;
/** x축 라벨 최대 개수 — 일 라벨 "11/30 (월)"이 겹치지 않을 만큼 */
const MAX_X_LABELS = 7;

function MarkerShape({ shape, x, y, color }: { shape: Marker; x: number; y: number; color: string }) {
  const common = { fill: color, stroke: "#ffffff", strokeWidth: 1.5 };
  if (shape === "square") return <rect x={x - 4} y={y - 4} width={8} height={8} {...common} />;
  if (shape === "triangle") return <path d={`M${x},${y - 5} L${x + 5},${y + 4} L${x - 5},${y + 4} Z`} {...common} />;
  if (shape === "diamond") return <path d={`M${x},${y - 5} L${x + 5},${y} L${x},${y + 5} L${x - 5},${y} Z`} {...common} />;
  return <circle cx={x} cy={y} r={4.5} {...common} />;
}

/** 범례 견본: 선 모양 + 점 모양 */
function LegendSwatch({ series }: { series: (typeof RATE_SERIES)[number] }) {
  return (
    <svg width="36" height="14" viewBox="0 0 36 14" aria-hidden>
      <line x1="1" y1="7" x2="35" y2="7" stroke={series.color} strokeWidth="2" strokeDasharray={series.dash} />
      <MarkerShape shape={series.marker} x={18} y={7} color={series.color} />
    </svg>
  );
}

function linePath(points: ({ x: number; y: number } | null)[]): string {
  let d = "";
  let pen = false;
  for (const point of points) {
    if (point === null) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)} `;
    pen = true;
  }
  return d.trim();
}

/** 앞뒤 구간 모두 값이 없는 점 — 선으로 이어지지 않아 점을 그려야만 보인다 */
function isIsolated(points: readonly (unknown | null)[], i: number): boolean {
  return points[i] !== null && (points[i - 1] ?? null) === null && (points[i + 1] ?? null) === null;
}

/**
 * 구간별 네 비율 선 그래프 (0~100%). 마우스를 올리면 그 구간의 값이 보인다. 같은 숫자는 아래 표에도 있다.
 * buckets는 기간 전체의 구간이어야 한다(fillBucketGaps로 빈 구간을 채운 것). x 위치를 순번으로 정하므로,
 * 빈 구간이 빠져 있으면 그 앞뒤 점이 선으로 이어져 버린다.
 */
export function RateChart({ buckets, unit }: { buckets: VisitBucket[]; unit: StatsUnit }) {
  const [active, setActive] = useState<number | null>(null);
  const n = buckets.length;
  const xOf = (i: number) => M.left + (n === 1 ? PLOT_W / 2 : (i * PLOT_W) / (n - 1));
  const yOf = (rate: number) => M.top + PLOT_H * (1 - rate);
  const band = n === 1 ? PLOT_W : PLOT_W / (n - 1);
  const labelStep = Math.max(1, Math.ceil(n / MAX_X_LABELS));
  const activeBucket = active === null ? null : buckets[active];

  return (
    <figure className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-700" aria-label="범례">
        {RATE_SERIES.map((series) => (
          <li key={series.key} className="flex items-center gap-2">
            <LegendSwatch series={series} />
            {series.label}
          </li>
        ))}
      </ul>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="img"
          aria-label="구간별 실내원율·노쇼율·당일취소율·지각률 선 그래프. 같은 값이 아래 구간별 표에 있습니다."
          onMouseLeave={() => setActive(null)}
        >
          {Y_TICKS.map((tick) => (
            <g key={tick}>
              <line x1={M.left} x2={W - M.right} y1={yOf(tick)} y2={yOf(tick)} stroke="#e2e8f0" strokeWidth={1} />
              <text x={M.left - 8} y={yOf(tick)} textAnchor="end" dominantBaseline="middle" fontSize={12} fill="#475569">
                {tick * 100}%
              </text>
            </g>
          ))}
          {buckets.map((bucket, i) =>
            i % labelStep === 0 || i === n - 1 ? (
              <text key={bucket.key} x={xOf(i)} y={H - 10} textAnchor="middle" fontSize={12} fill="#475569">
                {bucketLabel(bucket.key, unit)}
              </text>
            ) : null,
          )}
          {active !== null && (
            <line x1={xOf(active)} x2={xOf(active)} y1={M.top} y2={M.top + PLOT_H} stroke="#94a3b8" strokeWidth={1} />
          )}
          {RATE_SERIES.map((series) => {
            const points = buckets.map((bucket, i) => {
              const rate = bucket.stats[series.key];
              return rate === null ? null : { x: xOf(i), y: yOf(rate) };
            });
            const showMarkers = n <= MAX_MARKED_POINTS;
            return (
              <g key={series.key}>
                <path
                  d={linePath(points)}
                  fill="none"
                  stroke={series.color}
                  strokeWidth={2}
                  strokeDasharray={series.dash}
                  strokeLinejoin="round"
                />
                {points.map((point, i) =>
                  point && (showMarkers || i === active || isIsolated(points, i)) ? (
                    <MarkerShape key={i} shape={series.marker} x={point.x} y={point.y} color={series.color} />
                  ) : null,
                )}
              </g>
            );
          })}
          {buckets.map((bucket, i) => (
            <rect
              key={bucket.key}
              x={xOf(i) - band / 2}
              y={M.top}
              width={band}
              height={PLOT_H}
              fill="transparent"
              onMouseEnter={() => setActive(i)}
            />
          ))}
        </svg>
        {activeBucket && active !== null && (
          <ChartTooltip
            stats={activeBucket.stats}
            title={bucketLabel(activeBucket.key, unit)}
            leftPercent={(xOf(active) / W) * 100}
          />
        )}
      </div>
      <figcaption className="text-sm text-slate-600">
        예약이 없거나 비율을 낼 수 없는 구간(분모 0)은 선이 끊깁니다. 정확한 숫자는 아래 구간별 표에 있습니다.
      </figcaption>
    </figure>
  );
}

function ChartTooltip({ stats, title, leftPercent }: { stats: VisitStats; title: string; leftPercent: number }) {
  const alignRight = leftPercent > 60;
  return (
    <div
      className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-md"
      style={alignRight ? { right: `${100 - leftPercent + 2}%` } : { left: `${leftPercent + 2}%` }}
    >
      <p className="mb-1 font-semibold text-slate-900">{title}</p>
      <ul className="flex flex-col gap-0.5">
        {RATE_SERIES.map((series) => (
          <li key={series.key} className="flex items-center justify-between gap-3 text-slate-700">
            <span className="flex items-center gap-1.5">
              <LegendSwatch series={series} />
              {series.label}
            </span>
            <span className="font-semibold tabular-nums text-slate-900">{formatRate(stats[series.key])}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-slate-500">유효 예약 {stats.booked}건</p>
    </div>
  );
}
