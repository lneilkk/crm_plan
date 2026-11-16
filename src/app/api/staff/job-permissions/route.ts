import { z } from "zod";
import { STAFF_ROLES } from "@/lib/domain/staff";
import { defineRoute } from "@/server/api/define-route";
import { getJobPermissionMatrix, saveJobPermissionMatrix } from "@/server/staff/permission-admin";

/**
 * 직무 × 권한 표 — 확장 계획 S-7. [편집] → [권한]. 권한 관리 권한(staff.manage)이 있어야 한다.
 * 환자 정보는 없지만 권한 구성이라 읽기도 감사 행에 남긴다.
 */
export const GET = defineRoute({
  permission: "staff.manage",
  audit: "JOB_PERMISSIONS_READ",
  handler: async (ctx) => ({ jobPermissions: await getJobPermissionMatrix(ctx.db) }),
});

/**
 * 표를 통째로 저장한다(다섯 직무 모두). 민감 권한을 새로 켜면 confirmSensitive가 있어야 하고(없으면 409, 아무것도 안 바뀜),
 * 권한 관리 권한을 가진 활성 직원이 0명이 되면 409로 되돌린다.
 * 감사 행: 켠 칸·끈 칸("직무:권한")과 개수.
 */
export const PUT = defineRoute({
  permission: "staff.manage",
  audit: "JOB_PERMISSIONS_UPDATE",
  body: z.strictObject({
    jobPermissions: z.strictObject(Object.fromEntries(STAFF_ROLES.map((role) => [role, z.array(z.string().max(50)).max(50)])) as Record<
      (typeof STAFF_ROLES)[number],
      z.ZodArray<z.ZodString>
    >),
    confirmSensitive: z.boolean().optional(),
  }),
  handler: async (ctx) => {
    const { added, removed } = await saveJobPermissionMatrix(ctx.db, ctx.body.jobPermissions, { confirmSensitive: ctx.body.confirmSensitive === true });
    ctx.audit({ addedCount: added.length, removedCount: removed.length, added: added.join(","), removed: removed.join(",") });
    return { jobPermissions: await getJobPermissionMatrix(ctx.db), added, removed };
  },
});
