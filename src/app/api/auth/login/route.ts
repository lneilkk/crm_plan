import { z } from "zod";
import { navSectionsFor } from "@/lib/auth/permissions";
import { defineRoute } from "@/server/api/define-route";
import { ApiError } from "@/server/api/errors";
import { login } from "@/server/auth/login";
import { sessionCookieHeader, sessionTokenFrom } from "@/server/auth/session";

const LoginBody = z.object({
  loginId: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});

/**
 * 로그인 (T2-1). 성공하면 세션 쿠키(crm_session, httpOnly)를 내려 주고 직원 정보를 돌려준다.
 *
 * audit가 "none"인 이유: 요청 전에는 어느 직원인지 몰라 공통 계층이 감사 행을 쓸 수 없다.
 * 대신 src/server/auth/login.ts가 결과마다(SUCCESS / FAILED / DENIED) AUTH_LOGIN 행을 직접 쓴다.
 * 환자 정보는 다루지 않는다. 성공하면 쿠키에 있던 이전 세션은 끊는다(login.ts).
 * 본문은 defineRoute가 64 KiB까지만 읽는다(세션 없이 부르는 API라 큰 본문으로 메모리를 쓰게 하지 못하게).
 */
export const POST = defineRoute({
  permission: "public",
  audit: "none",
  body: LoginBody,
  handler: async (ctx) => {
    const result = await login(ctx.body, {
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      now: ctx.now,
      previousToken: sessionTokenFrom(ctx),
    });
    if (!result.ok) {
      if (result.reason === "LOCKED") {
        throw new ApiError(423, "ACCOUNT_LOCKED", "계정이 잠겼습니다. 관리자에게 해제를 요청하세요.");
      }
      throw new ApiError(401, "INVALID_CREDENTIALS", "아이디 또는 비밀번호가 올바르지 않습니다.");
    }
    const { staff } = result;
    return Response.json(
      { staff: { ...staff, navSections: navSectionsFor(staff.role) } },
      { headers: { "Set-Cookie": sessionCookieHeader(result.token, result.expiresAt) } },
    );
  },
});
