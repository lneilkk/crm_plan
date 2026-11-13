import type { Metadata } from "next";
import { CalendarScreen } from "@/components/calendar/calendar-screen";

export const metadata: Metadata = { title: "예약 캘린더 · 치과 CRM" };

// 즉시 이동(instant) 검사에서 뺀다. (app) 레이아웃의 AppShell은 /api/auth/me로 직원을 확인하기 전까지
// 이 화면(children)을 그리지 않으므로 서버 검사 렌더에서는 이 세그먼트가 항상 빠진다(instant-unrendered-segment).
// 환자 데이터는 캐시하지 않으므로(use cache 금지) 화면을 미리 채울 방법이 없다. 이동은 기존처럼 스트리밍된다.
export const instant = false;

/**
 * 예약 캘린더 — T4-2. 일·주 보기, 체어별·의사별 열, 빈 칸 클릭 등록, 끌어 옮기기.
 * 데이터는 브라우저에서 /api로 읽는다(CalendarScreen). 실제 차단은 각 API의 권한 검사다.
 */
export default function CalendarPage() {
  return <CalendarScreen />;
}
