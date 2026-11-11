/**
 * API 통합 테스트 도구 — route.ts 핸들러를 HTTP 서버 없이 직접 부른다.
 *
 *   const { cookie } = await loginAs("FRONT");
 *   const { status, json } = await callRoute(GET, { url: "/api/patients?q=가상", cookie });
 *   const res = await callRoute(POST, { method: "POST", url: "/api/staff/x/unlock", cookie, params: { id } });
 *
 * - loginAs는 직원과 세션을 DB에 바로 만든다(로그인 API를 거치지 않아 빠르다).
 * - callRoute의 요청은 http://localhost 로 가고, 같은 출처의 Origin을 붙인다(CSRF 검사 통과).
 *   다른 출처를 시험하려면 headers로 Origin을 덮어쓴다.
 */
import type { StaffRole } from "@/lib/domain/staff";
import type { RouteHandler } from "@/server/api/define-route";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session-cookie";
import { createSession } from "@/server/auth/session";
import { createStaff } from "./index";

export const TEST_ORIGIN = "http://localhost";

export async function loginAs(role: StaffRole, overrides: Parameters<typeof createStaff>[0] = {}) {
  const staff = await createStaff({ role, ...overrides });
  const { token, sessionId } = await createSession(staff.id, { ip: null, userAgent: "vitest", now: new Date() });
  return { staff, sessionId, cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

export type CallRouteOptions = {
  method?: string;
  /** "/api/..." 경로(쿼리 포함) 또는 전체 URL */
  url?: string;
  cookie?: string;
  /** 객체는 JSON으로 보낸다. 문자열은 그대로 보낸다(깨진 JSON 시험용). */
  body?: unknown;
  params?: Record<string, string | string[]>;
  headers?: Record<string, string>;
};

export async function callRoute(handler: RouteHandler, options: CallRouteOptions = {}) {
  const method = options.method ?? "GET";
  const url = new URL(options.url ?? "/api/test", TEST_ORIGIN);
  const headers = new Headers({ "user-agent": "vitest", ...(method !== "GET" ? { origin: TEST_ORIGIN } : {}) });
  if (options.cookie) headers.set("cookie", options.cookie);
  let body: string | undefined;
  if (options.body !== undefined) {
    body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    headers.set("content-type", "application/json");
  }
  for (const [key, value] of Object.entries(options.headers ?? {})) headers.set(key, value);

  const response = await handler(new Request(url, { method, headers, body }), {
    params: Promise.resolve(options.params ?? {}),
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  // 테스트에서 json.error.code처럼 바로 쓰도록 느슨한 타입으로 돌려준다.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: response.status, headers: response.headers, json: json as any, text };
}
