/**
 * T10-1 헬스체크 — DB가 응답하면 200 ok, 접속이 안 되면 503 error. 서버 정보·에러 문구를 내보내지 않는다.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();
vi.mock("@/server/db", () => ({ db: { $queryRaw: (...args: unknown[]) => queryRaw(...args) } }));

const { GET } = await import("./route");

async function call() {
  const response = await GET(new Request("http://localhost/api/health"), { params: Promise.resolve({}) });
  return { status: response.status, cacheControl: response.headers.get("cache-control"), json: await response.json() };
}

beforeEach(() => {
  queryRaw.mockReset();
});

describe("GET /api/health", () => {
  it("세션 없이 부를 수 있고, DB가 응답하면 200 { status: ok, db: ok }", async () => {
    queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ status: "ok", db: "ok" });
    expect(res.cacheControl).toBe("no-store");
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("DB에 접속할 수 없으면 503 { status: error, db: error }이고 에러 문구를 내보내지 않는다", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    queryRaw.mockRejectedValue(new Error("connect ECONNREFUSED postgresql://crm:비밀@127.0.0.1:54329/crm"));
    const res = await call();
    expect(res.status).toBe(503);
    expect(res.json).toEqual({ status: "error", db: "error" });
    expect(res.cacheControl).toBe("no-store");
    const logged = warn.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(logged).toContain("health.db_unreachable");
    expect(logged).not.toContain("ECONNREFUSED");
    expect(logged).not.toContain("postgresql://");
    warn.mockRestore();
  });
});
