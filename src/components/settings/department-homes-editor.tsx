"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch, ApiRequestError, ME_QUERY_KEY } from "@/lib/auth/api-client";
import { DEPARTMENT_NAMES, DEPARTMENTS, type Department, NAV_SECTIONS } from "@/lib/auth/permissions";
import { HOME_CHOICES, INITIAL_DEPARTMENT_HOMES } from "@/lib/auth/screen-registry";
import { STAFF_ROLE_LABEL } from "@/lib/domain/staff";
import { Button, Card, CardTitle, FieldError, Select, Spinner } from "@/components/ui";

const CHOICE_LABEL = Object.fromEntries(NAV_SECTIONS.map((section) => [section.href, section.label]));

/**
 * [편집] → [부서별 첫 화면] (확장 계획 S-4) — 로그인하면 처음 보이는 화면을 부서마다 정한다. 메뉴 화면 중에서만 고른다.
 * 그 화면을 볼 권한이 없는 사람은 볼 수 있는 메뉴의 첫 화면으로 간다.
 */
export function DepartmentHomesEditor({ onSaved }: { onSaved: (message: string) => void }) {
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => apiFetch<{ departmentHomes?: Record<string, unknown> }>("/api/settings") });
  if (!settings.data) return <Spinner showLabel />;
  const stored = settings.data.departmentHomes ?? {};
  const initial = Object.fromEntries(
    DEPARTMENT_NAMES.map((d) => [d, typeof stored[d] === "string" && HOME_CHOICES.includes(stored[d] as string) ? (stored[d] as string) : INITIAL_DEPARTMENT_HOMES[d]]),
  ) as Record<Department, string>;
  return <Form key={JSON.stringify(initial)} initial={initial} onSaved={onSaved} />;
}

function Form({ initial, onSaved }: { initial: Record<Department, string>; onSaved: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [homes, setHomes] = useState(initial);
  const save = useMutation({
    mutationFn: () => apiFetch("/api/settings/department-homes", { method: "PUT", body: homes }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      onSaved("부서별 첫 화면을 저장했습니다.");
    },
  });
  return (
    <Card className="p-3">
      <CardTitle>부서별 첫 화면</CardTitle>
      <p className="mb-3 text-slate-600">로그인하면 처음 보이는 화면입니다. 그 화면을 볼 권한이 없는 직원은 볼 수 있는 메뉴의 첫 화면으로 갑니다.</p>
      <ul className="flex flex-col gap-2">
        {DEPARTMENT_NAMES.map((department) => (
          <li key={department} className="flex flex-wrap items-center gap-2">
            <span className="w-40 font-semibold">
              {DEPARTMENTS[department].label}
              <span className="ml-1 font-normal text-slate-500">({DEPARTMENTS[department].jobs.map((job) => STAFF_ROLE_LABEL[job]).join("·")})</span>
            </span>
            <Select
              aria-label={`${DEPARTMENTS[department].label} 첫 화면`}
              className="w-auto"
              value={homes[department]}
              onChange={(e) => setHomes((current) => ({ ...current, [department]: e.target.value }))}
            >
              {HOME_CHOICES.map((href) => (
                <option key={href} value={href}>
                  {CHOICE_LABEL[href] ?? href}
                </option>
              ))}
            </Select>
          </li>
        ))}
      </ul>
      {save.isError && <FieldError className="mt-2">{save.error instanceof ApiRequestError ? save.error.message : "저장하지 못했습니다."}</FieldError>}
      <Button className="mt-3" disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? "저장 중…" : "첫 화면 저장"}
      </Button>
    </Card>
  );
}
