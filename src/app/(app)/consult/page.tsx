import type { Metadata } from "next";
import { ConsultScreen } from "@/components/consult/consult-screen";

export const metadata: Metadata = { title: "상담 · 치과 CRM" };

// (app)의 다른 화면과 같은 이유로 즉시 이동(instant) 검사에서 뺀다: AppShell이 직원을 확인하기 전에는 이 화면을 그리지 않는다.
export const instant = false;

/** 상담 탭 (F-10, T6-1·T6-2). 실제 차단은 /api/consultations의 consult.read·consult.write 검사다. */
export default function ConsultPage() {
  return <ConsultScreen />;
}
