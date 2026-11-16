"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { apiFetch, ME_QUERY_KEY } from "@/lib/auth/api-client";
import { Button, Card, FieldError, Input, Label } from "@/components/ui";

/** 아이디·비밀번호 로그인. 성공하면 그 사람의 첫 화면(부서별 설정, S-4)으로 간다. 비밀번호는 상태에만 두고 어디에도 저장하지 않는다. */
export function LoginForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: () => apiFetch<{ staff: { home: string } }>("/api/auth/login", { method: "POST", body: { loginId, password } }),
    onSuccess: ({ staff }) => {
      setPassword("");
      queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
      // 서버가 고를 수 있는 화면(메뉴 화면)으로만 정한 값이다. 그래도 내부 경로가 아니면 "/"로
      router.replace(staff.home.startsWith("/") && !staff.home.startsWith("//") ? staff.home : "/");
    },
    onError: () => setPassword(""),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!loginId.trim() || !password) return;
    login.mutate();
  }

  return (
    <Card className="p-6">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div>
          <Label htmlFor="loginId">아이디</Label>
          <Input
            id="loginId"
            name="loginId"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={loginId}
            onChange={(event) => setLoginId(event.target.value)}
            aria-invalid={login.isError || undefined}
            aria-describedby={login.isError ? "login-error" : undefined}
          />
        </div>
        <div>
          <Label htmlFor="password">비밀번호</Label>
          <Input
            id="password"
            name="password"
            type="password"
            // 기획서 10장: 브라우저에 비밀번호 저장 금지
            autoComplete="off"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={login.isError || undefined}
            aria-describedby={login.isError ? "login-error" : undefined}
          />
        </div>
        {login.isError && <FieldError id="login-error">{login.error.message}</FieldError>}
        <Button type="submit" size="lg" disabled={login.isPending || !loginId.trim() || !password}>
          {login.isPending ? "확인 중…" : "로그인"}
        </Button>
      </form>
    </Card>
  );
}
