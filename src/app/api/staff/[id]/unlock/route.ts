import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { ApiError } from "@/server/api/errors";
import { db } from "@/server/db";

/** 계정 잠금 해제 (T2-1, 관리자). 잠금 시각과 연속 실패 횟수를 지운다. */
export const POST = defineRoute({
  permission: "staff.manage",
  audit: "STAFF_UNLOCK",
  params: z.object({ id: z.uuid() }),
  handler: async (ctx) => {
    const updated = await db.staff.updateMany({
      where: { id: ctx.params.id },
      data: { lockedAt: null, failedLoginCount: 0 },
    });
    if (updated.count === 0) throw new ApiError(404, "NOT_FOUND", "직원을 찾을 수 없습니다.");
    ctx.audit({ targetStaffId: ctx.params.id });
    return { ok: true };
  },
});
