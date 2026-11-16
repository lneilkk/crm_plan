import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { ApiError } from "@/server/api/errors";
import { unlockStaff } from "@/server/auth/unlock";

/**
 * 계정 잠금 해제 (T2-1, 관리자). 잠금 시각과 연속 실패 횟수를 지운다.
 * 관리자가 모두 잠겨 이 화면을 쓸 수 없으면 서버에서 scripts/ops/staff-unlock.ts를 실행한다.
 */
export const POST = defineRoute({
  permission: "staff.manage",
  audit: "STAFF_UNLOCK",
  params: z.object({ id: z.uuid() }),
  handler: async (ctx) => {
    ctx.audit({ targetStaffId: ctx.params.id });
    if (!(await unlockStaff(ctx.db, ctx.params.id))) throw new ApiError(404, "NOT_FOUND", "직원을 찾을 수 없습니다.");
    return { ok: true };
  },
});
