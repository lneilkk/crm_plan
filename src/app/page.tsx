import { HomeRedirect } from "@/components/auth/home-redirect";

// 이 화면은 곧바로 다른 곳으로 보내므로 즉시 이동(instant) 검사에서 뺀다.
export const instant = false;

/** "/" — 로그인한 사람의 첫 화면(부서별 설정, 확장 계획 S-4)으로 보낸다. 로그인 전이면 proxy가 /login으로 보낸다. */
export default function Home() {
  return <HomeRedirect />;
}
