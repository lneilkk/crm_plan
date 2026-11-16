"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch, ApiRequestError, ME_QUERY_KEY } from "@/lib/auth/api-client";
import { departmentOf, DEPARTMENTS, isSensitivePermission, type Permission, PERMISSION_NAMES, PERMISSIONS } from "@/lib/auth/permissions";
import { STAFF_ROLE_LABEL, STAFF_ROLES, type StaffRole } from "@/lib/domain/staff";
import { Badge, Button, Card, CardTitle, FieldError, Spinner } from "@/components/ui";

export type JobPermissionMatrix = Record<StaffRole, Permission[]>;

/** 직무 × 권한 표 조회 키 — [직원]의 추가 권한 편집도 같이 쓴다 */
export const JOB_PERMISSIONS_QUERY_KEY = ["job-permissions"] as const;

export function useJobPermissions() {
  return useQuery({
    queryKey: JOB_PERMISSIONS_QUERY_KEY,
    queryFn: () => apiFetch<{ jobPermissions: JobPermissionMatrix }>("/api/staff/job-permissions"),
    staleTime: 0,
  });
}

/**
 * [편집] → [권한] — 확장 계획 S-7. 직무 × 권한 표에 체크해 직무별 기본 권한을 정한다(DB job_permission).
 * - 저장하면 그 직무의 모든 직원에게 다음 요청부터 바로 반영된다(서버가 요청마다 계산).
 * - 민감 권한을 새로 켜면 확인 창을 한 번 더 띄운다(서버도 확인 없이는 거부).
 * - 권한 관리 권한을 가진 직원이 0명이 되는 저장은 서버가 거부한다. 감사 로그·상태 이력을 고치거나 지우는 권한은 목록에 없다.
 */
export function PermissionMatrixEditor({ onSaved }: { onSaved: (message: string) => void }) {
  const matrix = useJobPermissions();
  if (matrix.isPending) return <Spinner showLabel />;
  if (matrix.isError) return <FieldError>{matrix.error.message}</FieldError>;
  return <MatrixForm key={JSON.stringify(matrix.data.jobPermissions)} saved={matrix.data.jobPermissions} onSaved={onSaved} />;
}

function MatrixForm({ saved, onSaved }: { saved: JobPermissionMatrix; onSaved: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<StaffRole, string[]>>(saved);
  const [confirming, setConfirming] = useState(false);

  const isOn = (role: StaffRole, permission: Permission) => draft[role].includes(permission);
  const wasOn = (role: StaffRole, permission: Permission) => (saved[role] as string[]).includes(permission);
  const toggle = (role: StaffRole, permission: Permission) =>
    setDraft((current) => ({
      ...current,
      [role]: isOn(role, permission) ? current[role].filter((p) => p !== permission) : [...current[role], permission],
    }));

  const cells = STAFF_ROLES.flatMap((role) => PERMISSION_NAMES.map((permission) => ({ role, permission })));
  const changed = cells.filter(({ role, permission }) => isOn(role, permission) !== wasOn(role, permission));
  const sensitiveGrants = changed.filter(({ role, permission }) => isOn(role, permission) && isSensitivePermission(permission));

  const save = useMutation({
    mutationFn: (confirmSensitive: boolean) =>
      apiFetch("/api/staff/job-permissions", { method: "PUT", body: { jobPermissions: draft, confirmSensitive } }),
    onSuccess: async () => {
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: JOB_PERMISSIONS_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      onSaved("직무별 권한을 저장했습니다.");
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.code === "SENSITIVE_CONFIRM_REQUIRED") setConfirming(true);
    },
  });
  const errorMessage =
    save.error && !(save.error instanceof ApiRequestError && save.error.code === "SENSITIVE_CONFIRM_REQUIRED")
      ? save.error instanceof ApiRequestError
        ? save.error.message
        : "저장하지 못했습니다."
      : null;

  function submit() {
    if (sensitiveGrants.length > 0) setConfirming(true);
    else save.mutate(false);
  }

  return (
    <Card className="p-3">
      <CardTitle>권한</CardTitle>
      <ul className="mb-3 list-disc pl-5 text-sm text-slate-600">
        <li>직무마다 기본 권한을 정합니다. 사람마다 더 줄 권한은 [직원]의 [추가 권한]에서 정합니다.</li>
        <li>저장하면 그 직무의 직원 화면에 바로 반영됩니다. 모든 변경은 감사 로그에 남습니다.</li>
        <li>
          <Badge tone="warning">민감</Badge> 권한을 새로 줄 때는 한 번 더 확인합니다. 직원 계정·권한 관리 권한을 가진 직원은 한 명 이상 남아야 합니다.
        </li>
      </ul>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label="직무별 권한">
          <thead className="text-left text-slate-600">
            <tr>
              <th className="py-1 pr-2">권한</th>
              {STAFF_ROLES.map((role) => (
                <th key={role} className="px-2 py-1 text-center">
                  {STAFF_ROLE_LABEL[role]}
                  <span className="block text-xs font-normal text-slate-500">{DEPARTMENTS[departmentOf(role)].label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_NAMES.map((permission) => (
              <tr key={permission} className="border-t border-slate-100">
                <th scope="row" className="py-1 pr-2 text-left font-normal">
                  <span className="font-semibold text-slate-800">{PERMISSIONS[permission]}</span>{" "}
                  {isSensitivePermission(permission) && <Badge tone="warning">민감</Badge>}
                  <span className="block font-mono text-xs text-slate-400">{permission}</span>
                </th>
                {STAFF_ROLES.map((role) => (
                  <td key={role} className={`px-2 py-1 text-center ${isOn(role, permission) !== wasOn(role, permission) ? "bg-amber-50" : ""}`}>
                    <input
                      type="checkbox"
                      className="size-5 cursor-pointer"
                      aria-label={`${STAFF_ROLE_LABEL[role]} — ${PERMISSIONS[permission]}`}
                      checked={isOn(role, permission)}
                      disabled={save.isPending}
                      onChange={() => toggle(role, permission)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirming && (
        <div role="alertdialog" aria-label="민감 권한 확인" className="mt-3 rounded-lg border-2 border-amber-400 bg-amber-50 p-3">
          <p className="font-semibold text-amber-900">아래 민감 권한을 새로 줍니다. 그 직무의 모든 직원이 바로 쓰게 됩니다.</p>
          <ul className="my-2 list-disc pl-5 text-sm">
            {sensitiveGrants.map(({ role, permission }) => (
              <li key={`${role}:${permission}`}>
                {STAFF_ROLE_LABEL[role]} — {PERMISSIONS[permission]}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button disabled={save.isPending} onClick={() => save.mutate(true)}>
              {save.isPending ? "저장 중…" : "주고 저장"}
            </Button>
            <Button variant="secondary" disabled={save.isPending} onClick={() => setConfirming(false)}>
              취소
            </Button>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button disabled={changed.length === 0 || save.isPending || confirming} onClick={submit}>
          {save.isPending && !confirming ? "저장 중…" : "권한 저장"}
        </Button>
        <Button variant="ghost" disabled={changed.length === 0 || save.isPending} onClick={() => setDraft(saved)}>
          되돌리기
        </Button>
        <span className="text-sm text-slate-600">{changed.length > 0 ? `바뀐 칸 ${changed.length}개` : "바뀐 칸 없음"}</span>
        {errorMessage && <FieldError>{errorMessage}</FieldError>}
      </div>
    </Card>
  );
}
