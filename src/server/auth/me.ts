import "server-only";

import { departmentOf, navSectionsFor, permissionsOf, type StaffAccess } from "@/lib/auth/permissions";
import type { StaffRole } from "@/lib/domain/staff";

/**
 * 화면에 내려 보내는 "나" 정보 (GET /api/auth/me, 로그인 응답). 화면은 권한 이름 목록(permissions)으로만
 * 버튼·영역을 숨긴다. 직무·추가 권한 원본은 내려 보내지 않는다(권한 계산은 서버의 permissionsOf 한 곳).
 */
export function meOf(staff: StaffAccess & { id: string; name: string; loginId: string; role: StaffRole }) {
  return {
    id: staff.id,
    name: staff.name,
    loginId: staff.loginId,
    role: staff.role,
    department: departmentOf(staff.role),
    permissions: permissionsOf(staff),
    navSections: navSectionsFor(staff),
  };
}
