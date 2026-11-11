/**
 * 브라우저에서 /api를 부르는 도구. 화면 코드(React Query의 queryFn·mutationFn)가 쓴다.
 *
 *   useQuery({ queryKey: ["staff", role], queryFn: () => apiFetch<{ staff: StaffOption[] }>(`/api/staff?role=${role}`) })
 *   useMutation({ mutationFn: (body) => apiFetch("/api/...", { method: "POST", body }) })
 *
 * - 세션 쿠키는 같은 출처라 자동으로 붙는다.
 * - 실패하면 ApiRequestError(status, code, message)를 던진다. message는 서버가 준 한국어 문구라 화면에 그대로 보여도 된다.
 * - 401은 src/app/providers.tsx가 받아서 로그인 화면으로 보낸다.
 * - 모든 요청에 이 브라우저의 기기 id를 x-input-device로 붙인다(device-id.ts). 서버는 상태 이력에 입력 기기로 남긴다.
 */
import { getDeviceId, INPUT_DEVICE_HEADER } from "./device-id";
import type { NavSectionKey } from "./permissions";
import type { StaffRole } from "@/lib/domain/staff";

export class ApiRequestError extends Error {
  override name = "ApiRequestError";

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** 검증 실패 시 필드 경로 목록 등 서버가 덧붙인 값 */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const NETWORK_ERROR_MESSAGE = "서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도하세요.";

export async function apiFetch<T = unknown>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    const headers: Record<string, string> = { [INPUT_DEVICE_HEADER]: getDeviceId() };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    response = await fetch(url, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiRequestError(0, "NETWORK", NETWORK_ERROR_MESSAGE);
  }

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string } } | null)?.error;
    const { code, message, ...details } = error ?? {};
    throw new ApiRequestError(
      response.status,
      code ?? "HTTP_ERROR",
      message ?? "요청을 처리하지 못했습니다. 다시 시도하세요.",
      details,
    );
  }
  return data as T;
}

/** GET /api/auth/me 응답 */
export type Me = {
  id: string;
  name: string;
  role: StaffRole;
  loginId: string;
  navSections: NavSectionKey[];
};

export const ME_QUERY_KEY = ["auth", "me"] as const;
