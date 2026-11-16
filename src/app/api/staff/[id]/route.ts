import { z } from "zod";
import { PASSWORD_MAX_LENGTH } from "@/lib/auth/password-policy";
import { STAFF_ROLES } from "@/lib/domain/staff";
import { defineRoute } from "@/server/api/define-route";
import { updateStaffAccount } from "@/server/staff/manage";

/**
 * 직원 계정 고치기 — F-14(T2-5 일부), 관리자: 이름·역할·재직(비활성화)·비밀번호 초기화.
 * 개인 추가 권한(S-7): extraPermissions(바꾼 뒤 전체 목록), 민감 권한을 새로 줄 때 confirmSensitive.
 * 추가 권한이 있는 직원의 직무를 바꿀 때는 extraPermissions도 보내야 한다(유지할 목록, 지우면 []).
 * 감사 행: 바꾼 필드 이름, 역할 변경(fromRole→toRole), 준·뺀 추가 권한 이름, 끊은 세션 수. 비밀번호는 남기지 않는다.
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
      extraPermissions: z.array(z.string().max(50)).max(50).optional(),
      confirmSensitive: z.boolean().optional(),
    })
    .refine((body) => Object.entries(body).some(([key, v]) => key !== "confirmSensitive" && v !== undefined), { message: "empty" }),
  handler: async (ctx) => {
    ctx.audit({ targetStaffId: ctx.params.id });
    const result = await updateStaffAccount(ctx.db, ctx.staff.id, ctx.params.id, ctx.body, ctx.now);
    ctx.audit({
      fields: Object.keys(ctx.body).join(","),
      ...(result.fromRole !== result.toRole ? { fromRole: result.fromRole, toRole: result.toRole } : {}),
      ...(result.addedExtras.length > 0 ? { addedExtras: result.addedExtras.join(",") } : {}),
      ...(result.removedExtras.length > 0 ? { removedExtras: result.removedExtras.join(",") } : {}),
      sessionsRevoked: result.sessionsRevoked,
    });
    return { ok: true };
  },
});
