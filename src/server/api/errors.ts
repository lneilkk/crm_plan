import "server-only";

/**
 * API 에러. 핸들러에서 throw new ApiError(404, "NOT_FOUND", "고객을 찾을 수 없습니다")처럼 던진다.
 * 응답은 { error: { code, message } }. 메시지는 화면에 그대로 보이는 한국어 문장이며,
 * 이름·전화번호 같은 입력값을 넣지 않는다(절대 규칙 6).
 */
export class ApiError extends Error {
  override name = "ApiError";

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** 응답의 error 객체에 덧붙일 값 (예: 검증 실패한 필드 경로). 값 원문은 넣지 않는다. */
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const INTERNAL_ERROR_MESSAGE = "서버에서 문제가 생겼습니다. 잠시 후 다시 시도하세요.";

export function errorResponse(status: number, code: string, message: string, extra?: Record<string, unknown>): Response {
  return Response.json({ error: { code, message, ...extra } }, { status, headers: { "Cache-Control": "no-store" } });
}

export function apiErrorResponse(error: ApiError): Response {
  return errorResponse(error.status, error.code, error.message, error.extra);
}
