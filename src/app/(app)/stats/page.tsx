import type { Metadata } from "next";
import { StatsDashboard } from "@/components/stats/stats-dashboard";

export const metadata: Metadata = { title: "통계 · 치과 CRM" };

/**
 * 통계 대시보드 (원장·관리자) — T7-2.
 * 권한 확인과 데이터 조회는 브라우저에서 /api로 한다(StatsDashboard). 실제 차단은 GET /api/stats의 stats.read 검사다.
 */
export default function StatsPage() {
  return <StatsDashboard />;
}
