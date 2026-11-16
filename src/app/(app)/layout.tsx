import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell/app-shell";

/**
 * 로그인 후 화면(내원 보드, 캘린더, 고객, 통계)의 공통 틀.
 * 세션은 서버에서 읽지 않는다(Cache Components에서 cookies()는 Suspense 안에서만 읽을 수 있다).
 * AppShell이 브라우저에서 /api/auth/me를 불러 직원을 확인하고, 데이터는 각 화면이 /api로 읽는다.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
