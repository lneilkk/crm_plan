import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session-cookie";

/**
 * 화면 요청의 낙관적 확인 — 세션 쿠키가 아예 없으면 로그인 화면으로 보낸다.
 * 쿠키가 진짜인지는 여기서 보지 않는다. 실제 인증·권한 검사는 모든 API의 defineRoute가 한다.
 * /api, /_next, 정적 파일(확장자가 있는 경로), /login은 matcher에서 뺀다.
 * 첫 화면 "/"는 page.tsx가 그 사람의 부서별 첫 화면으로 보낸다(S-4).
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.has(SESSION_COOKIE_NAME)) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/|_next/|login(?:/|$)|.*\\.[^/]+$).*)"],
};
