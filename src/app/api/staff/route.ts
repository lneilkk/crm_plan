import { z } from "zod";
import { STAFF_ROLES } from "@/lib/domain/staff";
import { defineRoute } from "@/server/api/define-route";
import { db } from "@/server/db";
import { PASSWORD_MAX_LENGTH } from "@/lib/auth/password-policy";
import { createStaffAccount } from "@/server/staff/manage";

/**
 * 재직 중인 직원 목록 — 예약 화면의 의사·상담자 드롭다운용. id·이름·역할만 돌려준다.
 * 환자 정보를 다루지 않아 감사 행은 없다.
 */
export const GET = defineRoute({
  permission: "staff.read",
  audit: "none",
  query: z.object({ role: z.enum(STAFF_ROLES).optional() }),
  handler: async (ctx) => {
    const staff = await db.staff.findMany({
      where: { isActive: true, ...(ctx.query.role ? { role: ctx.query.role } : {}) },
      select: { id: true, name: true, role: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return { staff };
  },
});

/** 직원 추가 — F-14(T2-5 일부), 관리자. 첫 비밀번호는 비밀번호 규칙을 따른다. 감사 행에는 역할만. */
export const POST = defineRoute({
  permission: "staff.manage",
  audit: "STAFF_CREATE",
  body: z.strictObject({
    loginId: z.string().trim().min(3).max(30),
    name: z.string().trim().min(1).max(50),
    role: z.enum(STAFF_ROLES),
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH * 4),
  }),
  handler: async (ctx) => {
    const created = await createStaffAccount(ctx.db, ctx.body);
    ctx.audit({ targetStaffId: created.id, role: ctx.body.role });
    return Response.json(created, { status: 201 });
  },
});
