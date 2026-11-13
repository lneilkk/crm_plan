/**
 * 화면 등록부 — 확장 계획 S-3. 권한에 따라 보이고 숨는 화면 영역을 한 곳에 모은다.
 *
 * - 화면 코드는 역할·부서를 직접 비교하지 않고, 여기 등록한 영역 이름으로만 묻는다(<Allowed area>, useAccess().allows).
 *   역할 직접 비교·권한 이름 직접 검사가 화면 코드에 있으면 src/components/auth/no-role-checks.test.ts가 실패한다.
 * - 숨기는 것은 편의일 뿐이다. 실제 차단은 API의 권한 검사(defineRoute)와 금액 빼기(src/server/appointments/price.ts)가 한다.
 * - 상단 메뉴는 NAV_SECTIONS(permissions.ts)다. 페이지 진입 검사·부서별 첫 화면은 S-4에서 이 파일에 더한다.
 * - 영역의 권한을 바꾸려면 이 표만 고친다. 직무별로 누가 그 권한을 갖는지는 DB(job_permission)에서 관리자가 정한다.
 */
import type { Permission } from "./permissions";

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
