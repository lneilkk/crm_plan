import { defineRoute } from "@/server/api/define-route";
import { meOf } from "@/server/auth/me";
import { getDepartmentHomes } from "@/server/settings/department-homes";

/** 로그인한 직원 정보, 권한 목록, 볼 수 있는 메뉴 구역. 화면이 쓴다. 환자 정보를 다루지 않아 감사 행은 없다. */
export const GET = defineRoute({
  permission: "authenticated",
  audit: "none",
  handler: async (ctx) => meOf(ctx.staff, await getDepartmentHomes()),
});
