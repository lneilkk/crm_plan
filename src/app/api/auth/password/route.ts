import { z } from "zod";
import { MAX_FAILED_LOGINS } from "@/server/auth/login";
import { PASSWORD_MAX_LENGTH } from "@/lib/auth/password-policy";
import { defineRoute } from "@/server/api/define-route";
import { errorResponse } from "@/server/api/errors";
import { changePassword } from "@/server/auth/change-password";

/**
 * 내 비밀번호 변경 (F-1). 로그인한 직원 누구나 자기 비밀번호만 바꾼다.
 * 다른 직원의 비밀번호 초기화는 직원 계정 관리(T2-5, 관리자)에서 한다.
 * 감사 행 detail에는 결과 코드·개수만 남긴다(비밀번호 원문 금지).
 */
const body = z.object({
  // 길이 제한은 해시 계산 부담을 막기 위한 것. 규칙 검사는 서비스가 한다.
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH * 4),
  newPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH * 4),
});

export const POST = defineRoute({
  permission: "authenticated",
  audit: "STAFF_PASSWORD_CHANGE",
  body,
  handler: async (ctx) => {
    const result = await changePassword(ctx.db, {
      staffId: ctx.staff.id,
      sessionId: ctx.sessionId,
      currentPassword: ctx.body.currentPassword,
      newPassword: ctx.body.newPassword,
      now: ctx.now,
    });
    if (result.ok) {
      ctx.audit({ otherSessionsRevoked: result.otherSessionsRevoked });
      return { ok: true, otherSessionsRevoked: result.otherSessionsRevoked };
    }

    ctx.audit({ errorCode: result.code });
    switch (result.code) {
      case "INVALID_CURRENT_PASSWORD": {
        ctx.audit({ failedCount: result.failedCount, locked: result.locked });
        const left = Math.max(0, MAX_FAILED_LOGINS - result.failedCount);
        const message = result.locked
          ? `현재 비밀번호가 ${MAX_FAILED_LOGINS}번 틀려 계정이 잠겼습니다. 지금 화면은 계속 쓸 수 있지만, 다시 로그인하려면 관리자에게 잠금 해제를 요청하세요.`
          : `현재 비밀번호가 맞지 않습니다. ${left}번 더 틀리면 계정이 잠깁니다.`;
        return errorResponse(400, result.code, message, { locked: result.locked });
      }
      case "WEAK_PASSWORD":
        ctx.audit({ ruleCount: result.rules.length });
        return errorResponse(400, result.code, "새 비밀번호가 규칙에 맞지 않습니다.", { rules: result.rules });
      case "SAME_AS_CURRENT":
        return errorResponse(400, result.code, "새 비밀번호가 지금 비밀번호와 같습니다.");
      case "ACCOUNT_LOCKED":
        return errorResponse(423, result.code, "계정이 잠겨 있어 비밀번호를 바꿀 수 없습니다. 관리자에게 잠금 해제를 요청하세요.");
      case "NOT_FOUND":
        return errorResponse(404, result.code, "직원 정보를 찾을 수 없습니다.");
    }
  },
});
