"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { apiFetch, ApiRequestError, type Me, ME_QUERY_KEY } from "@/lib/auth/api-client";
import { Spinner } from "@/components/ui";

/** "/" — 로그인한 사람의 첫 화면(부서별 설정, S-4)으로 보낸다. 로그인 전이면 로그인 화면으로. */
export function HomeRedirect() {
  const router = useRouter();
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: () => apiFetch<Me>("/api/auth/me"), staleTime: 60_000 });
  const target = me.data?.home ?? (me.error instanceof ApiRequestError && me.error.status === 401 ? "/login" : null);
  useEffect(() => {
    // 서버가 메뉴 화면 중에서 정한 값이다. 내부 경로만 따른다.
    if (target && target.startsWith("/") && !target.startsWith("//")) router.replace(target);
  }, [target, router]);
  if (me.isError && !target) return <p className="p-6 text-lg">{me.error.message}</p>;
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner showLabel label="첫 화면으로 가는 중" />
    </div>
  );
}
