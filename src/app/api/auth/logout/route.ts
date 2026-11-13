import { defineRoute } from "@/server/api/define-route";
import { clearSessionCookieHeader, revokeSession } from "@/server/auth/session";

/** 로그아웃 (T2-1). 세션의 revoked_at을 채우고 쿠키를 지운다. */
export const POST = defineRoute({
  permission: "authenticated",
  audit: "AUTH_LOGOUT",
  handler: async (ctx) => {
    await revokeSession(ctx.sessionId, ctx.now, ctx.db);
    return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookieHeader() } });
  },
});
