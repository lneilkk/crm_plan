/**
 * T2-4 완료 기준 — 권한 선언이 없는 API는 테스트에서 실패한다.
 *
 * src/app/api 아래 모든 route.ts를 불러와, 내보낸 HTTP 메서드가 전부 defineRoute로 만들어졌고
 * 권한("public" / "authenticated" / PERMISSIONS의 이름)과 감사 코드를 명시했는지 검사한다.
 * 선언을 빠뜨린 defineRoute 호출은 타입 검사(npm run typecheck)에서 먼저 걸린다 — 아래 typeChecks 참고.
 */
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineRoute } from "./define-route";
import { checkRouteModule } from "./route-check";

// route.ts를 불러오기만 하고 실행하지 않는다. DB 접속 없이 불러올 수 있게 db를 빈 객체로 바꾼다.
vi.mock("@/server/db", () => ({ db: {} }));

/** 세션 없이 부를 수 있는 API. 여기에 없는 라우트가 "public"을 쓰면 실패한다. */
const PUBLIC_ROUTES = ["auth/login", "health"];

const API_DIR = fileURLToPath(new URL("../../app/api", import.meta.url));

function findRouteFiles(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((file) => /(^|[\\/])route\.(ts|tsx|js|mjs)$/.test(file))
    .map((file) => join(dir, file))
    .sort();
}

function routePathOf(file: string): string {
  return relative(API_DIR, file).split(sep).slice(0, -1).join("/");
}

describe("모든 API 라우트의 권한·감사 선언", () => {
  const files = findRouteFiles(API_DIR);

  it("검사할 route.ts를 찾았다", () => {
    expect(files.map(routePathOf)).toEqual(expect.arrayContaining(["auth/login", "auth/me", "staff/[id]/unlock"]));
  });

  it.each(files.map((file) => [routePathOf(file), file]))("%s", async (routePath, file) => {
    const mod = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
    expect(checkRouteModule(routePath, mod, PUBLIC_ROUTES)).toEqual([]);
  });
});

describe("검사기 자체", () => {
  const ok = defineRoute({ permission: "patient.read", audit: "PATIENT_SEARCH", handler: () => null });

  it("평범한 함수로 내보낸 메서드를 잡는다", () => {
    const bad = { GET: ok, POST: async () => Response.json({}) };
    expect(checkRouteModule("patients", bad, PUBLIC_ROUTES)).toEqual([
      "patients POST: defineRoute로 만들지 않은 핸들러",
    ]);
  });

  it("허용 목록에 없는 public 라우트를 잡는다", () => {
    const mod = { GET: defineRoute({ permission: "public", audit: "none", handler: () => null }) };
    expect(checkRouteModule("patients/export", mod, PUBLIC_ROUTES)).toHaveLength(1);
    expect(checkRouteModule("auth/login", mod, PUBLIC_ROUTES)).toEqual([]);
  });

  it("타입 검사를 우회한 알 수 없는 권한·빈 감사 코드를 잡는다", () => {
    const sneaky = defineRoute({ permission: "patient.delete", audit: "", handler: () => null } as never);
    expect(checkRouteModule("patients", { DELETE: sneaky }, PUBLIC_ROUTES)).toEqual([
      'patients DELETE: 알 수 없는 권한 "patient.delete"',
      "patients DELETE: 감사 코드가 없거나 형식이 틀림",
    ]);
  });

  it("메서드가 아닌 내보내기(라우트 설정 등)는 검사하지 않는다", () => {
    expect(checkRouteModule("staff", { GET: ok, maxDuration: 10 }, PUBLIC_ROUTES)).toEqual([]);
  });
});

// 타입 검사 전용 — 실행하지 않는다. 선언이 빠지면 tsc가 실패해야 하므로 @ts-expect-error가 "쓰이지 않음" 오류 없이 통과해야 한다.
export function typeChecks() {
  // @ts-expect-error permission은 필수다
  defineRoute({ audit: "none", handler: () => null });
  // @ts-expect-error audit는 필수다
  defineRoute({ permission: "patient.read", handler: () => null });
  // @ts-expect-error 권한 표에 없는 이름
  defineRoute({ permission: "patient.delete", audit: "none", handler: () => null });
  // @ts-expect-error 감사 코드는 대문자여야 한다
  defineRoute({ permission: "patient.read", audit: "patient_search", handler: () => null });

  defineRoute({
    permission: "patient.read",
    audit: "PATIENT_SEARCH",
    query: z.object({ q: z.string() }),
    handler: (ctx) => {
      const q: string = ctx.query.q;
      const role: string = ctx.staff.role;
      // @ts-expect-error 선언하지 않은 body는 undefined다
      const name: string = ctx.body.name;
      return { q, role, name };
    },
  });
  defineRoute({
    permission: "public",
    audit: "none",
    handler: (ctx) => {
      // @ts-expect-error public 라우트의 staff는 null이다
      return ctx.staff.id;
    },
  });
}
