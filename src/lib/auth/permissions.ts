/**
 * 권한·부서·직무 — 기획서 10장(업무별 최소 권한), T2-4, 확장 계획 S-2·S-2b.
 *
 * 서버·브라우저 공용. 프로그램에 두는 것은 "권한의 종류"(PERMISSIONS)와 처음 설치할 때의 값뿐이다.
 * - 권한: 작은 단위의 능력. API는 역할이 아니라 권한 이름으로 선언한다(defineRoute의 permission).
 * - 직무: staff.role 값(프론트·상담·의사·간호·관리자). 직무별 권한은 DB(job_permission)에 있고 관리자가 바꾼다(S-7).
 *   INITIAL_JOB_PERMISSIONS는 첫 설치 때 마이그레이션이 DB에 한 번만 넣은 값이다. 실행 중에는 DB가 기준이다.
 * - 부서: 직무의 묶음(프론트·상담·진료·운영). 직무에서 정해지므로 따로 저장하지 않는다.
 * - 개인 추가 권한: staff.extra_permissions. 직무 권한에 더해진다. 빼는 기능은 없다.
 *
 * 한 사람의 권한 = DB의 직무 권한 ∪ 개인 추가 권한 (아는 이름만). 서버가 계산한다(src/server/auth/access.ts).
 * 설정으로 풀 수 없는 규칙(CHECKLIST.md S 절): 권한 관리자 0명 방지, 로그 수정·삭제 권한 없음, 새 권한은 기본 꺼짐.
 * 새 권한을 PERMISSIONS에 더해도 DB에 켜기 전까지 아무도 갖지 않는다.
 */
import type { StaffRole } from "@/lib/domain/staff";

/** 권한 이름과 화면에 보일 설명 */
export const PERMISSIONS = {
  "patient.read": "고객 보기",
  "patient.write": "고객 등록·수정",
  "appointment.read": "예약·내원 보드 보기",
  "appointment.write": "예약 만들기·옮기기·고치기",
  "visit.write": "내원 상태 변경",
  "stats.read": "통계·실적 보기",
  "settings.read": "병원 설정 읽기",
  "settings.write": "병원 설정 바꾸기",
  /** 드롭다운용 직원 이름·직무만 */
  "staff.read": "직원 목록 보기",
  "staff.manage": "직원 계정 관리",
  /** 상담 내용 포함. 프론트·간호는 상담 내용을 볼 수 없다 (T6-1) */
  "consult.read": "상담 보기",
  "consult.write": "상담 쓰기·수술예약 전환",
  "surgery.record": "수술 참여 직원 기록",
  /** 실수 등 직원 관련 메모 (F-11) */
  "surgery.note": "수술 메모 보기·쓰기",
  "data.import": "기존 CRM 가져오기",
} as const satisfies Record<string, string>;

export type Permission = keyof typeof PERMISSIONS;

export const PERMISSION_NAMES = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.hasOwn(PERMISSIONS, value);
}

/** 부서 → 속한 직무 */
export const DEPARTMENTS = {
  FRONT: { label: "프론트", jobs: ["FRONT"] },
  CONSULT: { label: "상담", jobs: ["COUNSELOR"] },
  CLINICAL: { label: "진료", jobs: ["DOCTOR", "NURSE"] },
  OPERATIONS: { label: "운영", jobs: ["ADMIN"] },
} as const satisfies Record<string, { label: string; jobs: readonly StaffRole[] }>;

export type Department = keyof typeof DEPARTMENTS;

export const DEPARTMENT_NAMES = Object.keys(DEPARTMENTS) as Department[];

export function departmentOf(job: StaffRole): Department {
  const found = DEPARTMENT_NAMES.find((d) => (DEPARTMENTS[d].jobs as readonly StaffRole[]).includes(job));
  if (!found) throw new Error("부서가 없는 직무");
  return found;
}

const EVERYONE_READS = ["patient.read", "appointment.read", "settings.read", "staff.read", "surgery.record"] as const;

/** 권한 관리 권한 — 이 권한을 가진 활성 직원이 0명이 되는 변경은 거부한다 */
export const PERMISSION_MANAGER = "staff.manage" satisfies Permission;

/**
 * 처음 설치할 때의 직무별 권한. 마이그레이션 20261113010000_job_permission이 DB에 같은 값을 한 번만 넣는다
 * (tests/integration/job-permission.test.ts가 SQL을 돌려 확인). 시드·재배포는 DB 값을 덮어쓰지 않는다.
 */
export const INITIAL_JOB_PERMISSIONS = {
  FRONT: [...EVERYONE_READS, "patient.write", "appointment.write", "visit.write"],
  COUNSELOR: [...EVERYONE_READS, "patient.write", "appointment.write", "visit.write", "consult.read", "consult.write"],
  /** 원장의 통계·상담 보기는 개인 추가 권한으로 준다(사용자 결정 2026-11-13) */
  DOCTOR: [...EVERYONE_READS, "surgery.note"],
  NURSE: [...EVERYONE_READS, "visit.write"],
  ADMIN: PERMISSION_NAMES,
} as const satisfies Record<StaffRole, readonly Permission[]>;

/**
 * S-2 변환 마이그레이션(20261113000000_staff_extra_permissions)이 기존 계정에 준 추가 권한.
 * S-2 전에는 의사 역할이 통계·상담 보기를 가졌으므로, 그때 있던 의사 계정에는 그대로 남긴다.
 * 마이그레이션 SQL과 같아야 한다(tests/integration/staff-access.test.ts가 SQL을 실제로 돌려 확인).
 * 시드도 이 값을 쓴다.
 */
export const LEGACY_ROLE_EXTRAS = {
  FRONT: [],
  COUNSELOR: [],
  DOCTOR: ["stats.read", "consult.read"],
  NURSE: [],
  ADMIN: [],
} as const satisfies Record<StaffRole, readonly Permission[]>;

/** 권한 계산에 필요한 값: DB의 직무 권한(job_permission)과 개인 추가 권한 */
export type StaffAccess = { jobPermissions: readonly string[]; extraPermissions: readonly string[] };

/** 한 사람의 권한 (권한 목록 순서, 겹침 없음). 모르는 이름은 무시한다(기본 거부). */
export function permissionsOf(access: StaffAccess): Permission[] {
  const granted = new Set<string>([...access.jobPermissions, ...access.extraPermissions]);
  return PERMISSION_NAMES.filter((permission) => granted.has(permission));
}

/** 그 사람이 권한을 가졌는지. 표에 없는 권한·직무는 거부한다(기본 거부). */
export function hasPermission(access: StaffAccess, permission: Permission): boolean {
  if (!isPermission(permission)) return false;
  return permissionsOf(access).includes(permission);
}

/** 상단 메뉴 구역. 화면을 숨기는 것은 편의일 뿐이고, 실제 차단은 API의 권한 검사가 한다. */
export const NAV_SECTIONS = [
  { key: "board", label: "내원 보드", href: "/board", permission: "appointment.read" },
  { key: "calendar", label: "예약 캘린더", href: "/calendar", permission: "appointment.read" },
  { key: "consult", label: "상담", href: "/consult", permission: "consult.read" },
  { key: "patients", label: "고객", href: "/patients", permission: "patient.read" },
  { key: "stats", label: "통계", href: "/stats", permission: "stats.read" },
  { key: "import", label: "가져오기", href: "/import", permission: "data.import" },
] as const satisfies ReadonlyArray<{ key: string; label: string; href: string; permission: Permission }>;

export type NavSectionKey = (typeof NAV_SECTIONS)[number]["key"];

/** 그 권한으로 볼 수 있는 메뉴 구역 키 (NAV_SECTIONS 순서) */
export function navSectionsFor(permissions: readonly Permission[]): NavSectionKey[] {
  return NAV_SECTIONS.filter((section) => permissions.includes(section.permission)).map((section) => section.key);
}
