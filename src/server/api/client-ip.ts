import "server-only";

import { isIP } from "node:net";

/**
 * 감사 로그에 남길 접속 IP — 기획서 10장(접근 기록).
 *
 * X-Forwarded-For는 누구나 보낼 수 있으므로 그대로 믿지 않는다. 앞단에 우리가 둔 리버스 프록시
 * (운영: Caddy 1대, Task.md T10-4)의 수를 환경변수 TRUSTED_PROXY_HOPS로 받아, 오른쪽에서 그만큼
 * 들어간 항목만 쓴다. 각 프록시는 자기가 본 주소를 맨 끝에 덧붙이므로, 그보다 왼쪽은 클라이언트가
 * 지어낼 수 있는 값이다.
 *
 * - TRUSTED_PROXY_HOPS가 없거나 0(개발 기본값): 헤더를 믿지 않고 null을 남긴다.
 *   Next.js 라우트 핸들러의 Request에는 소켓 주소가 없어 대신 쓸 값이 없다.
 * - X-Real-IP는 쓰지 않는다(덧붙이는 방식이 아니라 어느 홉의 값인지 알 수 없다).
 * - IP 형식이 아니면 null.
 */
export function clientIp(request: Request, trustedHops: number = trustedProxyHops()): string | null {
  if (trustedHops <= 0) return null;
  const header = request.headers.get("x-forwarded-for");
  if (!header) return null;
  const hops = header.split(",").map((part) => part.trim());
  const candidate = hops[hops.length - trustedHops];
  return candidate && isIP(candidate) ? candidate : null;
}

function trustedProxyHops(): number {
  const value = Number(process.env.TRUSTED_PROXY_HOPS ?? "0");
  return Number.isInteger(value) && value > 0 ? value : 0;
}
