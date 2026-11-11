/**
 * 역할별 권한 — 기획서 10장(업무별 최소 권한), T2-4.
 *
 * 서버·브라우저 공용. API는 역할 목록이 아니라 권한 이름으로 선언한다(defineRoute의 permission).
 * 역할에 권한을 더하거나 뺄 때는 이 표만 고친다. permissions.test.ts가 칸마다 기대값을 검사한다.
 */
import { STAFF_ROLES, type StaffRole } from "@/lib/domain/staff";

export const PERMISSIONS = {
  "patient.read": ["FRONT", "COUNSELOR", "DOCTOR", "ADMIN"],
  "patient.write": ["FRONT", "COUNSELOR", "ADMIN"],
  "appointment.read": ["FRONT", "COUNSELOR", "DOCTOR", "ADMIN"],
  "appointment.write": ["FRONT", "COUNSELOR", "ADMIN"],
  /** 내원 상태 변경 */
  "visit.write": ["FRONT", "COUNSELOR", "ADMIN"],
  /** 통계 — 원장·관리자 */
  "stats.read": ["DOCTOR", "ADMIN"],
  "settings.read": ["FRONT", "COUNSELOR", "DOCTOR", "ADMIN"],
  "settings.write": ["ADMIN"],
  /** 드롭다운용 직원 이름·역할만 */
  "staff.read": ["FRONT", "COUNSELOR", "DOCTOR", "ADMIN"],
  /** 계정 잠금 해제 등 직원 계정 관리 */
  "staff.manage": ["ADMIN"],
} as const satisfies Record<string, readonly StaffRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export const PERMISSION_NAMES = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.hasOwn(PERMISSIONS, value);
}

/** 역할이 권한을 가졌는지. 표에 없는 권한·역할은 거부한다(기본 거부). */
export function can(role: StaffRole, permission: Permission): boolean {
  if (!STAFF_ROLES.includes(role) || !isPermission(permission)) return false;
  return (PERMISSIONS[permission] as readonly StaffRole[]).includes(role);
}

/** 상단 메뉴 구역. 화면을 숨기는 것은 편의일 뿐이고, 실제 차단은 API의 권한 검사가 한다. */
export const NAV_SECTIONS = [
  { key: "board", label: "내원 보드", href: "/board", permission: "appointment.read" },
  { key: "calendar", label: "예약 캘린더", href: "/calendar", permission: "appointment.read" },
  { key: "patients", label: "고객", href: "/patients", permission: "patient.read" },
  { key: "stats", label: "통계", href: "/stats", permission: "stats.read" },
] as const satisfies ReadonlyArray<{ key: string; label: string; href: string; permission: Permission }>;

export type NavSectionKey = (typeof NAV_SECTIONS)[number]["key"];

/** 역할이 볼 수 있는 메뉴 구역 키 (NAV_SECTIONS 순서) */
export function navSectionsFor(role: StaffRole): NavSectionKey[] {
  return NAV_SECTIONS.filter((section) => can(role, section.permission)).map((section) => section.key);
}
