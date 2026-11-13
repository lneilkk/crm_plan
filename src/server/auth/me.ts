import "server-only";

import { departmentOf, navSectionsFor, type Permission } from "@/lib/auth/permissions";
import type { StaffRole } from "@/lib/domain/staff";

/**
 * 화면에 내려 보내는 "나" 정보 (GET /api/auth/me, 로그인 응답). 화면은 권한 이름 목록(permissions)으로만
 * 버튼·영역을 숨긴다. 권한은 서버가 DB에서 계산한 값이다(src/server/auth/access.ts).
 */
export function meOf(staff: { id: string; name: string; loginId: string; role: StaffRole; permissions: Permission[] }) {
  return {
    id: staff.id,
    name: staff.name,
    loginId: staff.loginId,
    role: staff.role,
    department: departmentOf(staff.role),
    permissions: staff.permissions,
    navSections: navSectionsFor(staff.permissions),
  };
}
