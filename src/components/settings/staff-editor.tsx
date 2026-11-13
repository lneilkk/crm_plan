"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/auth/api-client";
import { checkPasswordPolicy, PASSWORD_RULE_SUMMARY } from "@/lib/auth/password-policy";
import { STAFF_ROLE_LABEL, STAFF_ROLES, type StaffRole } from "@/lib/domain/staff";
import { Badge, Button, Card, CardTitle, FieldError, Input, Select, Spinner } from "@/components/ui";

type Account = { id: string; loginId: string; name: string; role: StaffRole; isActive: boolean; locked: boolean; lastLoginAt: string | null };
const C = "min-h-9 py-1 text-sm";

/**
 * 직원 (F-14, T2-5 일부) — 의사·상담·간호·프론트·관리자 추가, 이름·역할 변경, 비활성화(바로 로그아웃), 비밀번호 초기화, 잠금 풀기.
 * 직원은 지우지 않고 비활성화한다(지난 예약·기록의 담당자가 남아야 하므로).
 */
export function StaffEditor({ onSaved }: { onSaved: (message: string) => void }) {
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ["staff", "accounts"], queryFn: () => apiFetch<{ staff: Account[] }>("/api/staff/accounts") });
  const [form, setForm] = useState({ loginId: "", name: "", role: "NURSE" as StaffRole, password: "" });
  const [error, setError] = useState<string | null>(null);

  const refresh = async (message: string) => {
    setError(null);
    await queryClient.invalidateQueries({ queryKey: ["staff"] });
    // 첫 목록 읽기가 아직 끝나지 않았으면 무효화가 그 응답(저장 전 목록)을 남길 수 있어, 목록을 한 번 더 확실히 읽는다.
    await accounts.refetch();
    onSaved(message);
  };
  const fail = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : "처리하지 못했습니다.");

  const create = useMutation({
    mutationFn: () => apiFetch("/api/staff", { method: "POST", body: form }),
    onSuccess: async () => {
      setForm({ loginId: "", name: "", role: form.role, password: "" });
      await refresh("직원을 추가했습니다.");
    },
    onError: fail,
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => apiFetch(`/api/staff/${id}`, { method: "PATCH", body }),
    onSuccess: () => refresh("직원 정보를 저장했습니다."),
    onError: fail,
  });
  const unlock = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/staff/${id}/unlock`, { method: "POST" }),
    onSuccess: () => refresh("잠금을 풀었습니다."),
    onError: fail,
  });

  const pwRules = form.password ? checkPasswordPolicy(form.password, { loginId: form.loginId }) : [];
  const canCreate = form.loginId.trim().length >= 3 && form.name.trim() && form.password && pwRules.length === 0;

  function resetPassword(account: Account) {
    const next = window.prompt(`${account.name}(${account.loginId})의 새 임시 비밀번호\n${PASSWORD_RULE_SUMMARY}`);
    if (next) patch.mutate({ id: account.id, body: { password: next } });
  }

  return (
    <Card className="p-3">
      <CardTitle>직원</CardTitle>
      <form
        className="mb-3 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2 text-sm"
        aria-label="직원 추가"
        onSubmit={(e) => {
          e.preventDefault();
          if (canCreate) create.mutate();
        }}
      >
        <Input aria-label="새 직원 이름" placeholder="이름" className={`${C} w-28`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input aria-label="새 직원 아이디" placeholder="아이디(영문)" autoCapitalize="none" className={`${C} w-32`} value={form.loginId} onChange={(e) => setForm({ ...form, loginId: e.target.value })} />
        <Select aria-label="새 직원 역할" className={`${C} w-auto`} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}>
          {STAFF_ROLES.map((r) => <option key={r} value={r}>{STAFF_ROLE_LABEL[r]}</option>)}
        </Select>
        <Input aria-label="새 직원 첫 비밀번호" type="password" autoComplete="off" placeholder="첫 비밀번호" className={`${C} w-40`} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <Button type="submit" className={C} disabled={!canCreate || create.isPending}>+ 직원 추가</Button>
        <span className="w-full text-xs text-slate-500">{pwRules.length > 0 ? `비밀번호 규칙: ${PASSWORD_RULE_SUMMARY}` : "첫 로그인 후 본인이 [비밀번호 변경]으로 바꾸게 하세요."}</span>
      </form>
      {error && <FieldError className="mb-2">{error}</FieldError>}
      {accounts.isPending ? (
        <Spinner showLabel />
      ) : accounts.isError ? (
        <FieldError>{accounts.error.message}</FieldError>
      ) : (
        <table className="w-full text-sm" aria-label="직원 목록">
          <thead className="text-left text-slate-600">
            <tr><th className="py-1">이름</th><th>아이디</th><th>역할</th><th>상태</th><th /></tr>
          </thead>
          <tbody>
            {accounts.data.staff.map((a) => (
              <StaffRow key={`${a.id}-${a.name}-${a.role}`} account={a} busy={patch.isPending || unlock.isPending}
                onSave={(body) => patch.mutate({ id: a.id, body })} onUnlock={() => unlock.mutate(a.id)} onResetPassword={() => resetPassword(a)} />
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function StaffRow({
  account,
  busy,
  onSave,
  onUnlock,
  onResetPassword,
}: {
  account: Account;
  busy: boolean;
  onSave: (body: Record<string, unknown>) => void;
  onUnlock: () => void;
  onResetPassword: () => void;
}) {
  const [name, setName] = useState(account.name);
  const [role, setRole] = useState(account.role);
  const changed = name.trim() !== account.name || role !== account.role;
  return (
    <tr className={`border-t border-slate-100 ${account.isActive ? "" : "text-slate-400"}`} aria-label={`직원 ${account.loginId}`}>
      <td className="py-1 pr-2"><Input aria-label={`${account.loginId} 이름`} className={`${C} w-28`} value={name} onChange={(e) => setName(e.target.value)} /></td>
      <td className="pr-2 font-mono">{account.loginId}</td>
      <td className="pr-2">
        <Select aria-label={`${account.loginId} 역할`} className={`${C} w-auto`} value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
          {STAFF_ROLES.map((r) => <option key={r} value={r}>{STAFF_ROLE_LABEL[r]}</option>)}
        </Select>
      </td>
      <td className="pr-2">
        {!account.isActive ? <Badge tone="muted">비활성</Badge> : account.locked ? <Badge tone="danger">잠김</Badge> : <Badge tone="success">사용 중</Badge>}
      </td>
      <td className="whitespace-nowrap py-1 text-right">
        <Button variant="secondary" className={C} disabled={!changed || busy} onClick={() => onSave({ ...(name.trim() !== account.name ? { name: name.trim() } : {}), ...(role !== account.role ? { role } : {}) })}>저장</Button>{" "}
        {account.locked && account.isActive && <><Button variant="ghost" className={C} disabled={busy} onClick={onUnlock}>잠금 풀기</Button>{" "}</>}
        <Button variant="ghost" className={C} disabled={busy || !account.isActive} onClick={onResetPassword}>비밀번호 초기화</Button>{" "}
        <Button variant="ghost" className={`${C} ${account.isActive ? "text-red-700" : ""}`} disabled={busy} onClick={() => onSave({ isActive: !account.isActive })}>
          {account.isActive ? "비활성화" : "다시 사용"}
        </Button>
      </td>
    </tr>
  );
}
