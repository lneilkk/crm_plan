import { navSectionsFor } from "@/lib/auth/permissions";
import { defineRoute } from "@/server/api/define-route";

/** 로그인한 직원 정보와 볼 수 있는 메뉴 구역. 화면 상단 바가 쓴다. 환자 정보를 다루지 않아 감사 행은 없다. */
export const GET = defineRoute({
  permission: "authenticated",
  audit: "none",
  handler: (ctx) => {
    const { id, name, role, loginId } = ctx.staff;
    return { id, name, role, loginId, navSections: navSectionsFor(role) };
  },
});
