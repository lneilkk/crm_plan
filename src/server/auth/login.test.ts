import { beforeEach, describe, expect, it, vi } from "vitest";

// DB 없이 돌리는 단위 테스트 — 로그인 흐름 자체는 tests/integration/auth.test.ts가 검사한다.
// 가짜 db는 어떤 DB 작업을 어떤 순서로 했는지만 기록한다.
const calls: string[] = [];
let foundStaff: Record<string, unknown> | null = null;
let updatedRows: { failed_login_count: number; locked: boolean }[] = [];

function recorder(prefix: string) {
  return {
    $queryRaw: vi.fn(async () => {
      calls.push(`${prefix}$queryRaw`);
      return updatedRows;
    }),
    auditLog: {
      create: vi.fn(async () => {
        calls.push(`${prefix}auditLog.create`);
      }),
    },
  };
}

vi.mock("@/server/db", () => ({
  db: {
    staff: {
      findUnique: vi.fn(async () => {
        calls.push("staff.findUnique");
        return foundStaff;
      }),
    },
    ...recorder(""),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      calls.push("$transaction");
      return fn(recorder("tx."));
    }),
  },
}));

import { DUMMY_PASSWORD_HASH, login } from "./login";
import { hashPassword, verifyPassword } from "./password";

describe("없는 아이디용 가짜 해시", () => {
  it("실제 계정 해시와 같은 argon2id 파라미터를 쓴다 (검증 시간이 같아야 한다)", async () => {
    const real = await hashPassword("dummy-check-password-0000");
    const params = (h: string) => h.split("$").slice(1, 4).join("$");
    expect(params(DUMMY_PASSWORD_HASH)).toBe(params(real));
  });

  it("형식이 올바르다 — 검증이 예외 없이 끝까지 돌고 false를 돌려준다", async () => {
    expect(await verifyPassword(DUMMY_PASSWORD_HASH, "아무 비밀번호")).toBe(false);
  });
});

describe("실패한 로그인은 계정이 있든 없든 같은 DB 작업을 한다 (응답 시간으로 계정 존재를 알 수 없게)", () => {
  const meta = { ip: null, userAgent: null, now: new Date("2026-11-11T01:00:00Z") };
  let realHash: string;

  beforeEach(async () => {
    calls.length = 0;
    updatedRows = [];
    realHash ??= await hashPassword("timing-test-password-0000");
  });

  function existing(overrides: Record<string, unknown> = {}) {
    return { id: "4f9c1a52-0000-4000-8000-000000000001", name: "가상직원", role: "FRONT", loginId: "timing1", passwordHash: realHash, isActive: true, lockedAt: null, ...overrides };
  }

  async function shapeFor(staff: Record<string, unknown> | null, rows: typeof updatedRows) {
    calls.length = 0;
    foundStaff = staff;
    updatedRows = rows;
    const result = await login({ loginId: "timing1", password: "wrong-password-0000" }, meta);
    expect(result).toEqual({ ok: false, reason: "INVALID_CREDENTIALS" });
    return [...calls];
  }

  it("없는 아이디·틀린 비밀번호·비활성 계정의 DB 작업 순서가 같다", async () => {
    const unknown = await shapeFor(null, []);
    const wrong = await shapeFor(existing(), [{ failed_login_count: 1, locked: false }]);
    const inactive = await shapeFor(existing({ isActive: false }), []);

    expect(unknown).toEqual(["staff.findUnique", "$transaction", "tx.$queryRaw", "tx.auditLog.create"]);
    expect(wrong).toEqual(unknown);
    expect(inactive).toEqual(unknown);
  });
});
