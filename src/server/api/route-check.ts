import "server-only";

import { isPermission } from "@/lib/auth/permissions";
import { AUDIT_ACTION_PATTERN } from "./audit";
import { routeMetaOf } from "./define-route";

/**
 * route.ts 모듈 검사 — T2-4 완료 기준("권한 선언이 없는 API는 테스트에서 실패").
 * routes.test.ts가 src/app/api 아래 모든 route.ts에 대해 부른다. 문제 목록이 비어 있어야 통과다.
 */

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

export function checkRouteModule(
  routePath: string,
  mod: Record<string, unknown>,
  publicAllowList: readonly string[],
): string[] {
  const problems: string[] = [];
  for (const method of HTTP_METHODS) {
    if (!(method in mod)) continue;
    const meta = routeMetaOf(mod[method]);
    if (!meta) {
      problems.push(`${routePath} ${method}: defineRoute로 만들지 않은 핸들러`);
      continue;
    }
    const { permission, audit } = meta;
    if (permission === "public") {
      if (!publicAllowList.includes(routePath)) {
        problems.push(`${routePath} ${method}: "public"은 허용 목록에 있는 라우트만 쓸 수 있다`);
      }
    } else if (permission !== "authenticated" && !(typeof permission === "string" && isPermission(permission))) {
      problems.push(`${routePath} ${method}: 알 수 없는 권한 "${String(permission)}"`);
    }
    if (audit !== "none" && !(typeof audit === "string" && AUDIT_ACTION_PATTERN.test(audit))) {
      problems.push(`${routePath} ${method}: 감사 코드가 없거나 형식이 틀림`);
    }
  }
  return problems;
}
