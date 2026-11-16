import { z } from "zod";
import { HOME_CHOICES } from "@/lib/auth/screen-registry";
import { defineRoute } from "@/server/api/define-route";
import { saveDepartmentHomes } from "@/server/settings/department-homes";

const home = z.string().refine((value) => HOME_CHOICES.includes(value), { message: "home" });

/**
 * 부서별 첫 화면 저장 — 확장 계획 S-4, 관리자([편집] → [부서별 첫 화면]). 네 부서를 모두 보낸다.
 * 고를 수 있는 것은 상단 메뉴 화면뿐이다. 권한이 없는 화면을 골라 두면 그 사람은 볼 수 있는 메뉴의 첫 화면으로 간다.
 */
export const PUT = defineRoute({
  permission: "settings.write",
  audit: "SETTINGS_DEPARTMENT_HOMES_UPDATE",
  body: z.strictObject({ FRONT: home, CONSULT: home, CLINICAL: home, OPERATIONS: home }),
  handler: async (ctx) => {
    const saved = await saveDepartmentHomes(ctx.db, ctx.body, ctx.staff.id);
    ctx.audit({ homes: Object.values(saved).join(",") });
    return { departmentHomes: saved };
  },
});
