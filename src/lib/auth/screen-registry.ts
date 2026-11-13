/**
 * 화면 등록부 — 확장 계획 S-3. 권한에 따라 보이고 숨는 화면 영역을 한 곳에 모은다.
 *
 * - 화면 코드는 역할·부서를 직접 비교하지 않고, 여기 등록한 영역 이름으로만 묻는다(<Allowed area>, useAccess().allows).
 *   역할 직접 비교·권한 이름 직접 검사가 화면 코드에 있으면 src/components/auth/no-role-checks.test.ts가 실패한다.
 * - 숨기는 것은 편의일 뿐이다. 실제 차단은 API의 권한 검사(defineRoute)와 금액 빼기(src/server/appointments/price.ts)가 한다.
 * - 상단 메뉴는 NAV_SECTIONS(permissions.ts)다. 화면(페이지) 진입 검사는 SCREENS, 부서별 첫 화면은 homeFor(S-4).
 * - 영역의 권한을 바꾸려면 이 표만 고친다. 직무별로 누가 그 권한을 갖는지는 DB(job_permission)에서 관리자가 정한다.
 */
import { type Department, NAV_SECTIONS, type Permission } from "./permissions";

export const SCREEN_AREAS = {
  // 내원 보드
  "board.visitActions": { label: "내원 보드 — 상태 버튼·되돌리기", permission: "visit.write" },
  "board.reschedule": { label: "내원 보드 — [예약변경]", permission: "appointment.write" },
  // 예약 캘린더·예약 상세
  "appointment.write": { label: "예약 등록·옮기기·[고치기]·라벨·[예약변경]", permission: "appointment.write" },
  "appointment.price": { label: "예약 금액(단가·할인율)·실적 금액·항목 단가", permission: "appointment.price" },
  "calendar.settings": { label: "예약 캘린더 — [편집] 탭", permission: "settings.write" },
  "surgery.participants": { label: "수술 기록 — 참여 직원 고르기", permission: "surgery.record" },
  "surgery.note": { label: "수술 기록 — 수술 메모", permission: "surgery.note" },
  // 상담
  "consult.write": { label: "상담 — [+ 상담 등록]·[고치기]·[→ 수술예약]", permission: "consult.write" },
  // 고객
  "patients.create": { label: "고객 — [고객 등록]", permission: "patient.write" },
  "patients.edit": { label: "고객 상세 — [수정]", permission: "patient.write" },
  // 통계
  "stats.view": { label: "통계·실적 화면", permission: "stats.read" },
} as const satisfies Record<string, { label: string; permission: Permission }>;

export type ScreenArea = keyof typeof SCREEN_AREAS;

export const SCREEN_AREA_NAMES = Object.keys(SCREEN_AREAS) as ScreenArea[];

/** 그 권한 목록으로 영역을 쓸 수 있는지. 등록부에 없는 영역은 거부한다. */
export function allowsArea(permissions: readonly Permission[], area: ScreenArea): boolean {
  if (!Object.hasOwn(SCREEN_AREAS, area)) return false;
  return permissions.includes(SCREEN_AREAS[area].permission);
}

/**
 * 화면(페이지) — S-4. 로그인 후 화면의 모든 page.tsx를 등록한다(screen-registry.test.ts가 빠진 것을 잡는다).
 * 권한이 없는 화면 주소로 들어오면 화면 틀(app-shell)이 그 화면을 그리지 않고 "권한 없음" 안내만 보인다
 * — 화면 코드가 아예 실행되지 않으므로 데이터 API를 부르지 않고 가짜 값(0 등)도 그리지 않는다. 데이터는 API가 403으로 막는다.
 * permission이 null이면 로그인만 하면 된다.
 */
export const SCREENS = [
  { path: "/board", label: "내원 보드", permission: "appointment.read" },
  { path: "/calendar", label: "예약 캘린더", permission: "appointment.read" },
  { path: "/consult", label: "상담", permission: "consult.read" },
  { path: "/patients", label: "고객", permission: "patient.read" },
  { path: "/patients/new", label: "고객 등록", permission: "patient.write" },
  { path: "/patients/[id]", label: "고객 상세", permission: "patient.read" },
  { path: "/stats", label: "통계", permission: "stats.read" },
  { path: "/import", label: "가져오기", permission: "data.import" },
  { path: "/account/password", label: "비밀번호 변경", permission: null },
] as const satisfies ReadonlyArray<{ path: string; label: string; permission: Permission | null }>;

export type Screen = (typeof SCREENS)[number];

/** 주소에 해당하는 화면. 고정 경로가 [id] 경로보다 먼저다(/patients/new). 등록부에 없으면 null */
export function screenForPath(pathname: string): Screen | null {
  const parts = pathname.replace(/\/+$/, "").split("/");
  const matches = (screen: Screen) => {
    const pattern = screen.path.split("/");
    return pattern.length === parts.length && pattern.every((seg, i) => (seg.startsWith("[") ? parts[i] !== "" : seg === parts[i]));
  };
  return SCREENS.find((screen) => !screen.path.includes("[") && matches(screen)) ?? SCREENS.find(matches) ?? null;
}

export function allowsScreen(permissions: readonly Permission[], screen: Screen): boolean {
  return screen.permission === null || permissions.includes(screen.permission);
}

/** 첫 화면으로 고를 수 있는 화면 = 상단 메뉴 화면 */
export const HOME_CHOICES: readonly string[] = NAV_SECTIONS.map((section) => section.href);

/**
 * 부서별 첫 화면의 초기값. 마이그레이션 20261113040000이 clinic_setting.department_homes에 한 번만 넣는다(기본값).
 * 실행 중에는 DB가 기준이고 관리자가 [편집] → [부서별 첫 화면]에서 바꾼다.
 */
export const INITIAL_DEPARTMENT_HOMES: Record<Department, string> = {
  FRONT: "/board",
  CONSULT: "/consult",
  CLINICAL: "/calendar",
  OPERATIONS: "/stats",
};

/**
 * 로그인한 사람의 첫 화면: 설정한 부서 첫 화면이 고를 수 있는 화면이고 권한이 있으면 그것,
 * 아니면 볼 수 있는 메뉴의 첫 화면, 그것도 없으면 비밀번호 변경.
 */
export function homeFor(department: Department, homes: Record<string, unknown>, permissions: readonly Permission[]): string {
  const chosen = homes[department];
  if (typeof chosen === "string" && HOME_CHOICES.includes(chosen)) {
    const screen = screenForPath(chosen);
    if (screen && allowsScreen(permissions, screen)) return chosen;
  }
  return NAV_SECTIONS.find((section) => permissions.includes(section.permission))?.href ?? "/account/password";
}
