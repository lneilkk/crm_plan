"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { apiFetch, ApiRequestError, type Me, ME_QUERY_KEY } from "@/lib/auth/api-client";
import {
  checkPasswordPolicy,
  PASSWORD_RULE_MESSAGES,
  PASSWORD_RULE_SUMMARY,
  type PasswordRule,
} from "@/lib/auth/password-policy";
import { Button, Card, FieldError, Input, Label } from "@/components/ui";

/**
 * 내 비밀번호 변경 (F-1). 현재 비밀번호 + 새 비밀번호 두 번.
 * 규칙은 서버와 같은 함수(checkPasswordPolicy)로 입력 중에 안내하고, 최종 판단은 서버가 한다.
 * 비밀번호는 이 컴포넌트 상태에만 두고, 성공·실패 뒤 바로 지운다. 브라우저 저장은 막는다(기획서 10장).
 */
export function PasswordForm() {
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: () => apiFetch<Me>("/api/auth/me") });
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState<{ otherSessionsRevoked: number } | null>(null);

  const rules: PasswordRule[] = next ? checkPasswordPolicy(next, { loginId: me.data?.loginId ?? "" }) : [];
  const mismatch = confirm.length > 0 && confirm !== next;
  const canSubmit = current.length > 0 && next.length > 0 && rules.length === 0 && confirm === next;

  const change = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true; otherSessionsRevoked: number }>("/api/auth/password", {
        method: "POST",
        body: { currentPassword: current, newPassword: next },
      }),
    onSuccess: (data) => {
      setDone({ otherSessionsRevoked: data.otherSessionsRevoked });
      setCurrent("");
      setNext("");
      setConfirm("");
    },
    onError: () => setCurrent(""),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || change.isPending) return;
    setDone(null);
    change.mutate();
  }

  const serverRules =
    change.error instanceof ApiRequestError && Array.isArray(change.error.details?.rules)
      ? (change.error.details.rules as PasswordRule[])
      : [];

  return (
    <Card className="p-6">
      {done && (
        <p role="status" className="mb-4 rounded-lg bg-green-50 p-3 text-base text-green-900">
          비밀번호를 바꿨습니다.
          {done.otherSessionsRevoked > 0 && ` 다른 PC에서 로그인해 있던 ${done.otherSessionsRevoked}곳은 로그아웃했습니다.`}
        </p>
      )}
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div>
          <Label htmlFor="currentPassword">현재 비밀번호</Label>
          <Input
            id="currentPassword"
            type="password"
            autoComplete="off"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="newPassword">새 비밀번호</Label>
          <Input
            id="newPassword"
            type="password"
            autoComplete="off"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            aria-invalid={rules.length > 0 || undefined}
            aria-describedby="newPassword-rules"
          />
          <div id="newPassword-rules" className="mt-1 text-sm">
            {rules.length === 0 ? (
              <p className={next ? "text-green-800" : "text-slate-600"}>
                {next ? "규칙에 맞습니다." : PASSWORD_RULE_SUMMARY}
              </p>
            ) : (
              <ul className="list-disc pl-5 text-red-700">
                {rules.map((rule) => (
                  <li key={rule}>{PASSWORD_RULE_MESSAGES[rule]}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div>
          <Label htmlFor="confirmPassword">새 비밀번호 확인</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="off"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            aria-invalid={mismatch || undefined}
            aria-describedby={mismatch ? "confirm-error" : undefined}
          />
          {mismatch && <FieldError id="confirm-error">새 비밀번호와 같게 입력하세요.</FieldError>}
        </div>
        {change.isError && (
          <div role="alert">
            <FieldError>{change.error.message}</FieldError>
            {serverRules.length > 0 && (
              <ul className="list-disc pl-5 text-sm text-red-700">
                {serverRules.map((rule) => (
                  <li key={rule}>{PASSWORD_RULE_MESSAGES[rule] ?? rule}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <Button type="submit" size="lg" disabled={!canSubmit || change.isPending}>
          {change.isPending ? "바꾸는 중…" : "비밀번호 바꾸기"}
        </Button>
      </form>
    </Card>
  );
}
