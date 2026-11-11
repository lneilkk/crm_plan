import type { Metadata } from "next";
import { CalendarScreen } from "@/components/calendar/calendar-screen";

export const metadata: Metadata = { title: "예약 캘린더 · 치과 CRM" };

/**
 * 예약 캘린더 — T4-2. 일·주 보기, 체어별·의사별 열, 빈 칸 클릭 등록, 끌어 옮기기.
 * 데이터는 브라우저에서 /api로 읽는다(CalendarScreen). 실제 차단은 각 API의 권한 검사다.
 */
export default function CalendarPage() {
  return <CalendarScreen />;
}
