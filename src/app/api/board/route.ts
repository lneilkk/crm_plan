import { z } from "zod";
import { isValidDateKey, kstDateKey } from "@/lib/time/kst";
import { defineRoute } from "@/server/api/define-route";
import { getBoard } from "@/server/board/query";

/**
 * 오늘의 내원 보드 — T5-3 (기획서 4-2). 그날(한국 시간, 기본 오늘) 예약을 시각순으로, 상단 요약과 함께.
 * 버튼·지각·미확인 강조는 서버 시각(ctx.now)으로 계산한다. 이름은 마스킹, 전화번호는 담지 않는다.
 */
export const GET = defineRoute({
  permission: "appointment.read",
  audit: "BOARD_READ",
  query: z.object({ date: z.string().refine(isValidDateKey).optional() }),
  handler: async (ctx) => {
    const board = await getBoard(ctx.query.date ?? kstDateKey(ctx.now), ctx.now);
    ctx.touchPatients([...new Set(board.items.map((item) => item.patientId))]);
    ctx.audit({ appointmentCount: board.items.length });
    return board;
  },
});
