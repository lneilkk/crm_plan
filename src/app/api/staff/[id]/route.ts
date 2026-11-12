import { z } from "zod";
import { PASSWORD_MAX_LENGTH } from "@/lib/auth/password-policy";
import { STAFF_ROLES } from "@/lib/domain/staff";
import { defineRoute } from "@/server/api/define-route";
import { updateStaffAccount } from "@/server/staff/manage";

/**
 * 직원 계정 고치기 — F-14(T2-5 일부), 관리자: 이름·역할·재직(비활성화)·비밀번호 초기화.
 * 감사 행: 바꾼 필드 이름, 역할 변경(fromRole→toRole), 끊은 세션 수. 비밀번호는 남기지 않는다.
 */
export const PATCH = defineRoute({
  permission: "staff.manage",
  audit: "STAFF_UPDATE",
  params: z.object({ id: z.uuid() }),
  body: z
    .strictObject({
      name: z.string().trim().min(1).max(50).optional(),
      role: z.enum(STAFF_ROLES).optional(),
      isActive: z.boolean().optional(),
      password: z.string().min(1).max(PASSWORD_MAX_LENGTH * 4).optional(),
    })
    .refine((body) => Object.values(body).some((v) => v !== undefined), { message: "empty" }),
  handler: async (ctx) => {
    ctx.audit({ targetStaffId: ctx.params.id });
    const result = await updateStaffAccount(ctx.db, ctx.staff.id, ctx.params.id, ctx.body, ctx.now);
    ctx.audit({
      fields: Object.keys(ctx.body).join(","),
      ...(result.fromRole !== result.toRole ? { fromRole: result.fromRole, toRole: result.toRole } : {}),
      sessionsRevoked: result.sessionsRevoked,
    });
    return { ok: true };
  },
});
