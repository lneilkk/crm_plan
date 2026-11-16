/**
 * 세션 쿠키 이름. 서버 세션(src/server/auth/session.ts)과 proxy(src/proxy.ts)가 같이 쓴다.
 * 쿠키 값은 httpOnly라 브라우저 코드에서는 읽을 수 없다.
 */
export const SESSION_COOKIE_NAME = "crm_session";
