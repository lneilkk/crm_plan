"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch, type Me, ME_QUERY_KEY } from "@/lib/auth/api-client";
import { allowsArea, type ScreenArea } from "@/lib/auth/screen-registry";

/**
 * 로그인한 직원이 화면 영역을 쓸 수 있는지 (S-3 화면 등록부). 권한은 GET /api/auth/me — 서버가 DB에서 계산한 값.
 * 숨기는 것은 편의일 뿐이고 실제 차단은 API가 한다. 읽기 전에는 아무 영역도 허용하지 않는다.
 */
export function useAccess(): { ready: boolean; allows: (area: ScreenArea) => boolean } {
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: () => apiFetch<Me>("/api/auth/me"), staleTime: 60_000 });
  const granted = me.data?.permissions ?? [];
  return { ready: me.isSuccess, allows: (area) => allowsArea(granted, area) };
}

/** 영역을 쓸 수 있을 때만 children을 그린다. 권한이 없으면 아무것도 그리지 않는다(빈 자리·잠긴 버튼도 없음). */
export function Allowed({ area, children }: { area: ScreenArea; children: React.ReactNode }) {
  const { allows } = useAccess();
  return allows(area) ? <>{children}</> : null;
}
