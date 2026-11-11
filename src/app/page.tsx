import { redirect } from "next/navigation";

// 이 화면은 곧바로 다른 곳으로 보내므로 즉시 이동(instant) 검사에서 뺀다.
export const instant = false;

/**
 * 첫 화면은 내원 보드다. 보통은 proxy(src/proxy.ts)가 먼저 "/" → /board(또는 /login)로 보내고,
 * 이 redirect는 proxy를 거치지 않은 경우의 대비다.
 */
export default function Home() {
  redirect("/board");
}
