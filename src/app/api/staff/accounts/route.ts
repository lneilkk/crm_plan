import { defineRoute } from "@/server/api/define-route";
import { listStaffAccounts } from "@/server/staff/manage";

/** 직원 계정 목록(비활성 포함) — F-14, 관리자. 환자 정보가 없지만 계정 정보라 조회를 감사 행에 남긴다. */
export const GET = defineRoute({
  permission: "staff.manage",
  audit: "STAFF_LIST",
  handler: async (ctx) => {
    const staff = await listStaffAccounts(ctx.db);
    ctx.audit({ count: staff.length });
    return { staff };
  },
});
