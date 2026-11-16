import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp } from "./client-ip";

function req(headers: Record<string, string>) {
  return new Request("http://127.0.0.1/api/x", { headers });
}

afterEach(() => vi.unstubAllEnvs());

describe("감사 로그 접속 IP — 클라이언트가 지어낸 X-Forwarded-For를 믿지 않는다", () => {
  it("신뢰하는 프록시가 없으면(기본값) 헤더를 무시하고 null", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "");
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4" }))).toBeNull();
    expect(clientIp(req({ "x-real-ip": "1.2.3.4" }))).toBeNull();
  });

  it("프록시 1개: 맨 오른쪽(프록시가 덧붙인) 주소만 쓴다 — 앞에 지어낸 값은 무시", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.7" }))).toBe("10.0.0.7");
    expect(clientIp(req({ "x-forwarded-for": "10.0.0.7" }))).toBe("10.0.0.7");
  });

  it("프록시 2개: 오른쪽에서 두 번째", () => {
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.7, 10.0.0.1" }), 2)).toBe("10.0.0.7");
  });

  it("홉 수보다 항목이 적거나, IP 형식이 아니거나, 헤더가 없으면 null", () => {
    expect(clientIp(req({ "x-forwarded-for": "10.0.0.7" }), 2)).toBeNull();
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4, not-an-ip" }), 1)).toBeNull();
    expect(clientIp(req({ "x-real-ip": "10.0.0.7" }), 1)).toBeNull();
    expect(clientIp(req({}), 1)).toBeNull();
  });

  it("IPv6도 받는다", () => {
    expect(clientIp(req({ "x-forwarded-for": "::1" }), 1)).toBe("::1");
  });

  it("잘못된 TRUSTED_PROXY_HOPS 값은 0으로 본다", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "abc");
    expect(clientIp(req({ "x-forwarded-for": "10.0.0.7" }))).toBeNull();
    vi.stubEnv("TRUSTED_PROXY_HOPS", "-1");
    expect(clientIp(req({ "x-forwarded-for": "10.0.0.7" }))).toBeNull();
  });
});
