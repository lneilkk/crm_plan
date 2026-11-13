import "server-only";

import { departmentOf, navSectionsFor, type Permission } from "@/lib/auth/permissions";
import { homeFor } from "@/lib/auth/screen-registry";
import type { StaffRole } from "@/lib/domain/staff";

/**
 * 화면에 내려 보내는 "나" 정보 (GET /api/auth/me, 로그인 응답). 화면은 권한 이름 목록(permissions)으로만
 * 버튼·영역을 숨긴다. 권한은 서버가 DB에서 계산한 값이다(src/server/auth/access.ts).
 * home: 부서별 첫 화면 설정(DB)에서 이 사람이 볼 수 있는 화면으로 정한 첫 화면(S-4).
 */
export function meOf(
  staff: { id: string; name: string; loginId: string; role: StaffRole; permissions: Permission[] },
  departmentHomes: Record<string, unknown>,
) {
  const department = departmentOf(staff.role);
  return {
    id: staff.id,
    name: staff.name,
    loginId: staff.loginId,
    role: staff.role,
    department,
    permissions: staff.permissions,
    navSections: navSectionsFor(staff.permissions),
    home: homeFor(department, departmentHomes, staff.permissions),
  };
}
