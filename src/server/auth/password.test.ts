import { parseOptions } from "@node-rs/argon2";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

// 테스트용 가짜 비밀번호. 실제 계정과 무관하다.
const PASSWORD = "테스트용-비밀번호-0000";

describe("hashPassword", () => {
  it("해시는 비밀번호 원문과 다르고 argon2id PHC 문자열이다", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).not.toBe(PASSWORD);
    expect(hash).not.toContain(PASSWORD);
    expect(hash.startsWith("$argon2id$")).toBe(true);
  });

  it("OWASP 최소 기준 이상의 파라미터로 만든다 (19 MiB, 2회, 병렬 1)", async () => {
    const options = parseOptions(await hashPassword(PASSWORD));
    expect(options.memoryCost).toBeGreaterThanOrEqual(19_456);
    expect(options.timeCost).toBeGreaterThanOrEqual(2);
    expect(options.parallelism).toBe(1);
    expect(options.saltLen).toBeGreaterThanOrEqual(16);
  });

  it("같은 비밀번호도 salt가 달라 해시가 매번 다르다", async () => {
    const [a, b] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, PASSWORD)).toBe(true);
    expect(await verifyPassword(b, PASSWORD)).toBe(true);
  });
});

describe("verifyPassword", () => {
  it("맞는 비밀번호면 true", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword(hash, PASSWORD)).toBe(true);
  });

  it("틀린 비밀번호면 false", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword(hash, "테스트용-비밀번호-0001")).toBe(false);
    expect(await verifyPassword(hash, "")).toBe(false);
  });

  it("형식이 깨진 해시면 예외 없이 false", async () => {
    const hash = await hashPassword(PASSWORD);
    for (const broken of ["", "not-a-hash", "$argon2id$", hash.slice(0, -10), "test-placeholder-not-a-password-hash"]) {
      await expect(verifyPassword(broken, PASSWORD)).resolves.toBe(false);
    }
  });
});
