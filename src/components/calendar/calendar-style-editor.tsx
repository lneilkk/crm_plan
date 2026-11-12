"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/auth/api-client";
import {
  DEFAULT_STATUS_STYLES,
  isHexColor,
  LABEL_NAME_MAX,
  MAX_LABELS,
  readableTextColor,
  STATUS_NAME_MAX,
  type StatusStyles,
} from "@/lib/calendar/colors";
import { APPOINTMENT_STATUSES, APPOINTMENT_STATUS_LABEL, type AppointmentStatus } from "@/lib/domain/appointment";
import { Button, Card, CardTitle, FieldError, Input } from "@/components/ui";
import { CALENDAR_STYLE_QUERY_KEY, type CalendarStyle } from "./calendar-style";

/**
 * 캘린더 [편집] 탭 — F-2, 관리자만(서버는 settings.write로 막는다).
 * 라벨: 추가·이름·색·순서·숨기기·삭제. 순서가 위일수록 칸 색 우선(금액 라벨을 맨 위에 두면 금액 색으로 칠해진다).
 * 상태: 목록은 고정(통계 규칙), 캘린더에 보이는 이름·색만 바꾼다.
 * 저장 버튼을 눌러야 반영된다. 예약에 붙어 있는 라벨은 지울 수 없고 숨기기만 된다(서버가 409로 막는다).
 */

type DraftLabel = { key: string; id?: string; name: string; color: string; isActive: boolean };

let draftSeq = 0;
const toDraft = (style: CalendarStyle): DraftLabel[] =>
  style.labels.map((label) => ({ key: label.id, id: label.id, name: label.name, color: label.color, isActive: label.isActive }));

export function CalendarStyleEditor({
  style,
  onSaved,
  section,
}: {
  style: CalendarStyle;
  onSaved: (message: string) => void;
  /** 보여 줄 부분 ([편집] 하위 메뉴) — 저장은 둘을 함께 보낸다 */
  section: "labels" | "statuses";
}) {
  const queryClient = useQueryClient();
  const [labels, setLabels] = useState<DraftLabel[]>(() => toDraft(style));
  const [statuses, setStatuses] = useState<StatusStyles>(() => ({ ...style.statusStyles }));

  const problems = validate(labels, statuses);

  const save = useMutation({
    mutationFn: () =>
      apiFetch<CalendarStyle>("/api/settings/calendar-style", {
        method: "PUT",
        body: {
          labels: labels.map(({ id, name, color, isActive }) => ({ ...(id ? { id } : {}), name: name.trim(), color, isActive })),
          statusStyles: Object.fromEntries(
            APPOINTMENT_STATUSES.map((status) => [status, { name: statuses[status].name.trim(), color: statuses[status].color }]),
          ),
        },
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(CALENDAR_STYLE_QUERY_KEY, saved);
      setLabels(toDraft(saved));
      setStatuses({ ...saved.statusStyles });
      onSaved("색 설정을 저장했습니다.");
    },
  });

  const updateLabel = (key: string, patch: Partial<DraftLabel>) =>
    setLabels((list) => list.map((label) => (label.key === key ? { ...label, ...patch } : label)));
  const moveLabel = (index: number, delta: number) =>
    setLabels((list) => {
      const target = index + delta;
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  return (
    <div className="flex flex-col gap-4">
      {section === "labels" && (
      <Card className="p-3">
        <CardTitle>색 라벨</CardTitle>
        <p className="mb-3 text-sm text-slate-600">
          예약에 여러 개를 붙일 수 있습니다. 칸 색은 붙은 라벨 중 <strong>이 목록에서 가장 위에 있는 라벨</strong>의 색입니다(라벨이 없으면 상태 색).
          금액 라벨을 맨 위에 두면 금액마다 다른 색으로 보입니다. 환자 이름·전화번호·진료 내용은 라벨 이름에 쓰지 마세요.
        </p>
        <ol className="flex flex-col gap-2">
          {labels.map((label, index) => (
            <li key={label.key} className="flex flex-wrap items-center gap-2" aria-label={`라벨 ${index + 1}: ${label.name || "(이름 없음)"}`}>
              <span className="w-6 text-right text-sm tabular-nums text-slate-500">{index + 1}</span>
              <Button variant="ghost" aria-label={`${label.name} 위로`} disabled={index === 0} onClick={() => moveLabel(index, -1)}>
                ▲
              </Button>
              <Button variant="ghost" aria-label={`${label.name} 아래로`} disabled={index === labels.length - 1} onClick={() => moveLabel(index, 1)}>
                ▼
              </Button>
              <ColorInput
                label={`${label.name || "새 라벨"} 색`}
                value={label.color}
                onChange={(color) => updateLabel(label.key, { color })}
              />
              <Input
                aria-label={`라벨 ${index + 1} 이름`}
                className="w-44"
                maxLength={LABEL_NAME_MAX}
                value={label.name}
                onChange={(e) => updateLabel(label.key, { name: e.target.value })}
              />
              <span
                className="rounded px-2 py-1 text-sm font-semibold"
                style={isHexColor(label.color) ? { backgroundColor: label.color, color: readableTextColor(label.color) } : undefined}
              >
                {label.name || "미리보기"}
              </span>
              <label className="flex min-h-11 items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={!label.isActive}
                  onChange={(e) => updateLabel(label.key, { isActive: !e.target.checked })}
                />
                숨기기
              </label>
              <Button
                variant="ghost"
                className="text-red-700"
                aria-label={`${label.name} 삭제`}
                onClick={() => setLabels((list) => list.filter((item) => item.key !== label.key))}
              >
                삭제
              </Button>
            </li>
          ))}
        </ol>
        <Button
          variant="secondary"
          className="mt-3"
          disabled={labels.length >= MAX_LABELS}
          onClick={() => setLabels((list) => [...list, { key: `new-${(draftSeq += 1)}`, name: "", color: "#90CAF9", isActive: true }])}
        >
          + 라벨 추가
        </Button>
      </Card>
      )}

      {section === "statuses" && (
      <Card className="p-3">
        <CardTitle>예약 상태 표시</CardTitle>
        <p className="mb-3 text-sm text-slate-600">
          상태 종류는 바꿀 수 없습니다(내원 보드와 통계가 씁니다). 캘린더에 보이는 이름과 색만 바꿉니다. 칸 왼쪽 띠와 상태 표시가 이 색입니다.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {APPOINTMENT_STATUSES.map((status) => (
            <StatusRow
              key={status}
              status={status}
              value={statuses[status]}
              onChange={(value) => setStatuses((current) => ({ ...current, [status]: value }))}
            />
          ))}
        </div>
        <Button variant="ghost" className="mt-3" onClick={() => setStatuses({ ...DEFAULT_STATUS_STYLES })}>
          상태 표시를 기본값으로
        </Button>
      </Card>
      )}

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-slate-200 bg-slate-50/95 py-3">
        <Button size="lg" disabled={problems.length > 0 || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "저장 중…" : "저장"}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setLabels(toDraft(style));
            setStatuses({ ...style.statusStyles });
            save.reset();
          }}
        >
          바꾼 것 취소
        </Button>
        <div role="alert" className="flex flex-col">
          {problems.map((problem) => (
            <FieldError key={problem}>{problem}</FieldError>
          ))}
          {save.isError && (
            <FieldError>{save.error instanceof ApiRequestError ? save.error.message : "저장하지 못했습니다. 다시 시도하세요."}</FieldError>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusRow({
  status,
  value,
  onChange,
}: {
  status: AppointmentStatus;
  value: { name: string; color: string };
  onChange: (value: { name: string; color: string }) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-sm text-slate-600">{APPOINTMENT_STATUS_LABEL[status]}</span>
      <ColorInput label={`${APPOINTMENT_STATUS_LABEL[status]} 색`} value={value.color} onChange={(color) => onChange({ ...value, color })} />
      <Input
        aria-label={`${APPOINTMENT_STATUS_LABEL[status]} 표시 이름`}
        className="w-32"
        maxLength={STATUS_NAME_MAX}
        value={value.name}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
      />
    </div>
  );
}

/** 색 고르기(색상표) + 직접 입력(#RRGGBB) */
function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (color: string) => void }) {
  return (
    <span className="flex items-center gap-1">
      <input
        type="color"
        aria-label={label}
        className="h-11 w-12 cursor-pointer rounded border border-slate-300 bg-white p-1"
        value={isHexColor(value) ? value.toLowerCase() : "#000000"}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
      />
      <Input
        aria-label={`${label} 코드`}
        className="w-28 font-mono"
        maxLength={7}
        value={value}
        onChange={(e) => onChange(e.target.value.trim().toUpperCase())}
      />
    </span>
  );
}

function validate(labels: DraftLabel[], statuses: StatusStyles): string[] {
  const problems: string[] = [];
  const names = labels.map((label) => label.name.trim().toLowerCase());
  if (names.some((name) => name.length === 0)) problems.push("이름이 빈 라벨이 있습니다.");
  if (new Set(names.filter(Boolean)).size !== names.filter(Boolean).length) problems.push("같은 이름의 라벨이 있습니다.");
  if (labels.some((label) => !isHexColor(label.color)) || APPOINTMENT_STATUSES.some((s) => !isHexColor(statuses[s].color))) {
    problems.push("색 코드는 #RRGGBB 형식이어야 합니다(예: #1E73E8).");
  }
  if (APPOINTMENT_STATUSES.some((s) => statuses[s].name.trim().length === 0)) problems.push("상태 표시 이름을 비울 수 없습니다.");
  return problems;
}
