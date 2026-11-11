import type { Metadata } from "next";
import { BoardScreen } from "@/components/board/board-screen";

export const metadata: Metadata = { title: "내원 보드 · 치과 CRM" };

/**
 * 오늘의 내원 보드 — T5-3 (기획서 4-2). 프론트의 첫 화면.
 * 데이터는 브라우저에서 /api로 읽고 바꾼다(BoardScreen). 실제 차단은 각 API의 권한 검사다.
 */
export default function BoardPage() {
  return <BoardScreen />;
}
