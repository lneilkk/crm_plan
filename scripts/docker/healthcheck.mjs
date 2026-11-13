/**
 * Docker HEALTHCHECK — 컨테이너 안에서 /api/health를 부른다 (T10-1).
 * slim 이미지에는 curl이 없어 node로 확인한다. 200이면 0, 아니면 1로 끝난다.
 * server.js와 같은 PORT를 쓴다. HOSTNAME과 상관없이 컨테이너 안의 127.0.0.1로 접속한다.
 */
const port = process.env.PORT || "3000";

try {
  const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(4000) });
  process.exit(response.status === 200 ? 0 : 1);
} catch {
  process.exit(1);
}
