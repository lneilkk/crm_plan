"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch, type Me, ME_QUERY_KEY } from "@/lib/auth/api-client";
import type { Permission } from "@/lib/auth/permissions";

/**
 * 로그인한 직원의 권한 (GET /api/auth/me — 서버가 DB에서 계산한 값). 화면에서 버튼·영역을 숨길 때 쓴다.
 * 숨기는 것은 편의일 뿐이고 실제 차단은 API가 한다. 읽기 전에는 아무 권한도 없는 것으로 본다.
 */
export function usePermissions(): { ready: boolean; has: (permission: Permission) => boolean } {
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: () => apiFetch<Me>("/api/auth/me"), staleTime: 60_000 });
  const granted = me.data?.permissions ?? [];
  return { ready: me.isSuccess, has: (permission) => granted.includes(permission) };
}
