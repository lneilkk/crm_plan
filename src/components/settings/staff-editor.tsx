"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch, ApiRequestError, ME_QUERY_KEY } from "@/lib/auth/api-client";
import { checkPasswordPolicy, PASSWORD_RULE_SUMMARY } from "@/lib/auth/password-policy";
import { STAFF_ROLE_LABEL, STAFF_ROLES, type StaffRole } from "@/lib/domain/staff";
import { Badge, Button, Card, CardTitle, FieldError, Input, Select, Spinner } from "@/components/ui";
import { isSensitivePermission, type Permission, PERMISSION_NAMES, PERMISSIONS } from "@/lib/auth/permissions";
import { useMe } from "@/components/shared/queries";
import { useJobPermissions } from "./permission-matrix-editor";

type Account = {
  id: string;
  loginId: string;
  name: string;
  role: StaffRole;
  isActive: boolean;
  locked: boolean;
  lastLoginAt: string | null;
  /** 개인 추가 권한 (S-7) */
  extraPermissions: Permission[];
};
const C = "min-h-9 py-1 text-sm";

/**
 * 직원 (F-14, T2-5 일부) — 의사·상담·간호·프론트·관리자 추가, 이름·역할 변경, 비활성화(바로 로그아웃), 비밀번호 초기화, 잠금 풀기.
 * 직원은 지우지 않고 비활성화한다(지난 예약·기록의 담당자가 남아야 하므로).
 * 개인 추가 권한(S-7): [추가 권한]에서 직무 기본 권한에 더할 권한을 고른다. 민감 권한은 한 번 더 확인한다.
 * 추가 권한이 있는 직원의 직무를 바꾸면 추가 권한을 지울지 유지할지 먼저 고른다(서버도 고르지 않으면 거부).
 * 자기 계정의 직무·추가 권한은 바꿀 수 없다.
 */
export function StaffEditor({ onSaved }: { onSaved: (message: string) => void }) {
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ["staff", "accounts"], queryFn: () => apiFetch<{ staff: Account[] }>("/api/staff/accounts") });
  const matrix = useJobPermissions();
  const me = useMe();
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      await refresh("직원 정보를 저장했습니다.");
    },
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
        <Input aria-label="새 직원 이름" placeholder="이름" className={`${C} w-28!`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input aria-label="새 직원 아이디" placeholder="아이디(영문)" autoCapitalize="none" className={`${C} w-32!`} value={form.loginId} onChange={(e) => setForm({ ...form, loginId: e.target.value })} />
        <Select aria-label="새 직원 역할" className={`${C} w-auto!`} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}>
          {STAFF_ROLES.map((r) => <option key={r} value={r}>{STAFF_ROLE_LABEL[r]}</option>)}
        </Select>
        <Input aria-label="새 직원 첫 비밀번호" type="password" autoComplete="off" placeholder="첫 비밀번호" className={`${C} w-40!`} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
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
            <tr><th className="py-1">이름</th><th>아이디</th><th>역할</th><th>추가 권한</th><th>상태</th><th /></tr>
          </thead>
          <tbody>
            {accounts.data.staff.map((a) => (
              <StaffRow key={`${a.id}-${a.name}-${a.role}-${a.extraPermissions.join(",")}`} account={a} busy={patch.isPending || unlock.isPending}
                isSelf={a.id === me.data?.id} jobPermissions={matrix.data?.jobPermissions[a.role] ?? []}
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
  isSelf,
  jobPermissions,
  onSave,
  onUnlock,
  onResetPassword,
}: {
  account: Account;
  busy: boolean;
  isSelf: boolean;
  /** 이 직원 직무의 기본 권한 — 추가 권한 편집에서 '직무에 있음'으로 보인다 */
  jobPermissions: readonly Permission[];
  onSave: (body: Record<string, unknown>) => void;
  onUnlock: () => void;
  onResetPassword: () => void;
}) {
  const [name, setName] = useState(account.name);
  const [role, setRole] = useState(account.role);
  const [panel, setPanel] = useState<"none" | "extras" | "reconfirm">("none");
  const changed = name.trim() !== account.name || role !== account.role;
  const nameBody = name.trim() !== account.name ? { name: name.trim() } : {};
  const extras = account.extraPermissions;

  function save() {
    // 추가 권한이 있는 직원의 직무를 바꾸면 추가 권한을 어떻게 할지 먼저 고른다 (S-7)
    if (role !== account.role && extras.length > 0) return setPanel("reconfirm");
    onSave({ ...nameBody, ...(role !== account.role ? { role } : {}) });
  }

  return (
    <>
      <tr className={`border-t border-slate-100 ${account.isActive ? "" : "text-slate-400"}`} aria-label={`직원 ${account.loginId}`}>
        <td className="py-1 pr-2"><Input aria-label={`${account.loginId} 이름`} className={`${C} w-28!`} value={name} onChange={(e) => setName(e.target.value)} /></td>
        <td className="pr-2 font-mono">{account.loginId}</td>
        <td className="pr-2">
          <Select aria-label={`${account.loginId} 역할`} className={`${C} w-auto!`} value={role} disabled={isSelf} title={isSelf ? "자기 계정의 직무는 바꿀 수 없습니다" : undefined} onChange={(e) => setRole(e.target.value as StaffRole)}>
            {STAFF_ROLES.map((r) => <option key={r} value={r}>{STAFF_ROLE_LABEL[r]}</option>)}
          </Select>
        </td>
        <td className="pr-2">
          <div className="flex flex-wrap items-center gap-1">
            {extras.length === 0 ? (
              <span className="text-slate-400">없음</span>
            ) : (
              <span className="text-xs text-slate-700">
                {extras.map((p, i) => (
                  <span key={p} className={isSensitivePermission(p) ? "font-semibold text-amber-800" : undefined}>
                    {i > 0 && ", "}
                    {PERMISSIONS[p]}
                  </span>
                ))}
              </span>
            )}
            {!isSelf && (
              <Button variant="ghost" className={C} aria-expanded={panel === "extras"} disabled={busy} onClick={() => setPanel(panel === "extras" ? "none" : "extras")}>
                추가 권한
              </Button>
            )}
          </div>
        </td>
        <td className="whitespace-nowrap pr-2">
          {!account.isActive ? <Badge tone="muted">비활성</Badge> : account.locked ? <Badge tone="danger">잠김</Badge> : <Badge tone="success">사용 중</Badge>}
        </td>
        <td className="whitespace-nowrap py-1 text-right">
          <Button variant="secondary" className={C} disabled={!changed || busy} onClick={save}>저장</Button>{" "}
          {account.locked && account.isActive && <><Button variant="ghost" className={C} disabled={busy} onClick={onUnlock}>잠금 풀기</Button>{" "}</>}
          <Button variant="ghost" className={C} disabled={busy || !account.isActive} onClick={onResetPassword}>비밀번호 초기화</Button>{" "}
          <Button variant="ghost" className={`${C} ${account.isActive ? "text-red-700" : ""}`} disabled={busy} onClick={() => onSave({ isActive: !account.isActive })}>
            {account.isActive ? "비활성화" : "다시 사용"}
          </Button>
        </td>
      </tr>
      {panel === "reconfirm" && (
        <tr>
          <td colSpan={6} className="pb-2">
            <div role="alertdialog" aria-label={`${account.loginId} 직무 변경 확인`} className="rounded-lg border-2 border-amber-400 bg-amber-50 p-3">
              <p className="font-semibold text-amber-900">
                {account.name}에게 추가 권한 {extras.length}개가 있습니다: {extras.map((p) => PERMISSIONS[p]).join(", ")}.
              </p>
              <p className="mb-2 text-sm text-amber-900">
                직무를 {STAFF_ROLE_LABEL[account.role]} → {STAFF_ROLE_LABEL[role]}(으)로 바꾸면서 추가 권한을 어떻게 할까요? 예전 직무 때문에 준 권한이면 지우세요.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button className={C} disabled={busy} onClick={() => onSave({ ...nameBody, role, extraPermissions: [] })}>추가 권한 지우고 바꾸기</Button>
                <Button variant="secondary" className={C} disabled={busy} onClick={() => onSave({ ...nameBody, role, extraPermissions: extras })}>추가 권한 유지하고 바꾸기</Button>
                <Button variant="ghost" className={C} disabled={busy} onClick={() => setPanel("none")}>취소</Button>
              </div>
            </div>
          </td>
        </tr>
      )}
      {panel === "extras" && (
        <tr>
          <td colSpan={6} className="pb-2">
            <ExtrasEditor account={account} jobPermissions={jobPermissions} busy={busy} onSave={(next, confirmSensitive) => onSave({ extraPermissions: next, ...(confirmSensitive ? { confirmSensitive } : {}) })} onClose={() => setPanel("none")} />
          </td>
        </tr>
      )}
    </>
  );
}

/** 개인 추가 권한 고르기 (S-7). 직무에 이미 있는 권한은 '직무에 있음'으로 보이고 고를 필요가 없다 */
function ExtrasEditor({
  account,
  jobPermissions,
  busy,
  onSave,
  onClose,
}: {
  account: Account;
  jobPermissions: readonly Permission[];
  busy: boolean;
  onSave: (next: Permission[], confirmSensitive: boolean) => void;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<Permission[]>(account.extraPermissions);
  const [confirming, setConfirming] = useState(false);
  const next = PERMISSION_NAMES.filter((p) => chosen.includes(p));
  const granted = next.filter((p) => !account.extraPermissions.includes(p));
  const sensitiveGrants = granted.filter((p) => isSensitivePermission(p));
  const changed = next.length !== account.extraPermissions.length || granted.length > 0;
  return (
    <div role="group" aria-label={`${account.loginId} 추가 권한`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="mb-2 text-sm text-slate-700">
        {account.name}({STAFF_ROLE_LABEL[account.role]} 직무)에게 더 줄 권한을 고르세요. 저장하면 그 직원 화면에 바로 반영되고 감사 로그에 남습니다.
      </p>
      <div className="grid gap-1 sm:grid-cols-2">
        {PERMISSION_NAMES.map((p) => {
          const inJob = jobPermissions.includes(p);
          return (
            <label key={p} className={`flex items-center gap-2 text-sm ${inJob ? "text-slate-400" : ""}`}>
              <input
                type="checkbox"
                className="size-4"
                checked={inJob || chosen.includes(p)}
                disabled={inJob || busy}
                onChange={() => setChosen(chosen.includes(p) ? chosen.filter((x) => x !== p) : [...chosen, p])}
              />
              {PERMISSIONS[p]}
              {isSensitivePermission(p) && <Badge tone="warning">민감</Badge>}
              {inJob && <span className="text-xs">(직무에 있음)</span>}
            </label>
          );
        })}
      </div>
      {confirming ? (
        <div role="alertdialog" aria-label="민감 권한 확인" className="mt-2 rounded-lg border-2 border-amber-400 bg-amber-50 p-2">
          <p className="font-semibold text-amber-900">
            {account.name}에게 민감 권한을 새로 줍니다: {sensitiveGrants.map((p) => PERMISSIONS[p]).join(", ")}
          </p>
          <div className="mt-2 flex gap-2">
            <Button className={C} disabled={busy} onClick={() => onSave(next, true)}>주고 저장</Button>
            <Button variant="secondary" className={C} disabled={busy} onClick={() => setConfirming(false)}>취소</Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <Button className={C} disabled={!changed || busy} onClick={() => (sensitiveGrants.length > 0 ? setConfirming(true) : onSave(next, false))}>추가 권한 저장</Button>
          <Button variant="ghost" className={C} onClick={onClose}>닫기</Button>
        </div>
      )}
    </div>
  );
}
