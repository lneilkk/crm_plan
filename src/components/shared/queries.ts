"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch, type Me, ME_QUERY_KEY } from "@/lib/auth/api-client";
import type { ClinicSettings } from "@/lib/domain/clinic";
import type { StaffRole } from "@/lib/domain/staff";

/**
 * 여러 화면이 같이 쓰는 조회 — 확장 계획 S-6. 같은 데이터를 화면마다 따로 조회하던 것을 한 곳에 모았다.
 * 조회 키가 같아 React Query 캐시를 함께 쓴다. 환자 데이터는 여기 두지 않는다(화면마다 새로 읽는다).
 */
const SHARED_STALE_MS = 60_000;
const ME_REFRESH_MS = 30_000;

/**
 * 로그인한 직원(권한·메뉴·첫 화면) — GET /api/auth/me.
 * 관리자가 권한을 바꾸면 바로 맞춰지도록(S-7): 화면을 옮길 때마다 새로 읽고(staleTime 0), 가만히 있어도 30초마다 읽는다.
 * 다른 API가 403을 돌려줘도 다시 읽는다(src/app/providers.tsx). 실제 차단은 언제나 서버가 요청마다 한다.
 */
export function useMe() {
  return useQuery({ queryKey: ME_QUERY_KEY, queryFn: () => apiFetch<Me>("/api/auth/me"), staleTime: 0, refetchInterval: ME_REFRESH_MS });
}


/** 병원 설정을 저장한 뒤 다시 읽게 할 때 쓰는 키 */
export const SETTINGS_QUERY_KEY = ["settings"] as const;

/** 병원 설정(체어·예약 항목·진료시간·부서별 첫 화면 등) — GET /api/settings */
export function useClinicSettings() {
  return useQuery({ queryKey: SETTINGS_QUERY_KEY, queryFn: () => apiFetch<ClinicSettings & { departmentHomes?: Record<string, unknown> }>("/api/settings"), staleTime: SHARED_STALE_MS });
}

/** 드롭다운용 직원 목록(재직 중) */
export type StaffOption = { id: string; name: string; role: StaffRole };

/** 직원 목록 — GET /api/staff. role을 주면 그 직무만, 안 주면 모두 */
export function useStaffOptions(role?: StaffRole, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["staff", role ?? "all"],
    queryFn: () => apiFetch<{ staff: StaffOption[] }>(role ? `/api/staff?role=${role}` : "/api/staff"),
    staleTime: SHARED_STALE_MS,
    enabled: options.enabled ?? true,
  });
}
