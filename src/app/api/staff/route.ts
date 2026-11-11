import { z } from "zod";
import { STAFF_ROLES } from "@/lib/domain/staff";
import { defineRoute } from "@/server/api/define-route";
import { db } from "@/server/db";

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
