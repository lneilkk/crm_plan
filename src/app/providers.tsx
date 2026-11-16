"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { ApiRequestError, ME_QUERY_KEY } from "@/lib/auth/api-client";

/**
 * 세션이 끝난(401) 요청이 하나라도 있으면 로그인 화면으로 보낸다.
 * 클라이언트 이동이 아니라 페이지를 새로 읽어, 메모리에 남은 환자 데이터(React Query 캐시)를 모두 버린다.
 */
function redirectToLoginOn401(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 401 && window.location.pathname !== "/login") {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- 위 설명대로 전체 새로고침이 목적
    window.location.assign("/login");
  }
}

function createQueryClient() {
  /**
   * 권한 없음(403)을 받으면 내 권한(/api/auth/me)을 다시 읽는다 — 관리자가 권한을 바꾼 직후에도 메뉴·버튼이 바로 맞춰진다(S-7).
   * 내 정보 조회 자체의 403은 다시 부르지 않는다(되풀이 방지).
   */
  const refreshAccessOn403 = (error: unknown, queryKey?: readonly unknown[]) => {
    if (error instanceof ApiRequestError && error.status === 403 && queryKey?.[0] !== ME_QUERY_KEY[0]) {
      void client.invalidateQueries({ queryKey: ME_QUERY_KEY });
    }
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        redirectToLoginOn401(error);
        refreshAccessOn403(error, query.queryKey);
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        redirectToLoginOn401(error);
        refreshAccessOn403(error);
      },
    }),
    defaultOptions: {
      queries: {
        // 창으로 돌아올 때 다시 읽지 않는다. 주기적으로 새로 읽을 화면(내원 보드 등)은 refetchInterval을 직접 정한다.
        refetchOnWindowFocus: false,
        // 4xx(권한·검증·세션)는 다시 시도해도 같으므로 한 번만, 네트워크·서버 오류만 한 번 더 시도한다.
        retry: (failureCount, error) =>
          failureCount < 1 && !(error instanceof ApiRequestError && error.status >= 400 && error.status < 500),
      },
      mutations: { retry: false },
    },
  });
  return client;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
