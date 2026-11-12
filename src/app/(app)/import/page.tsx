import type { Metadata } from "next";
import { ImportScreen } from "@/components/import/import-screen";

export const metadata: Metadata = { title: "가져오기 · 치과 CRM" };

// (app)의 다른 화면과 같은 이유로 즉시 이동(instant) 검사에서 뺀다: AppShell이 직원을 확인하기 전에는 이 화면을 그리지 않는다.
export const instant = false;

/** 기존 CRM 엑셀 가져오기 (F-7, 관리자). 실제 차단은 POST /api/import/[kind]의 data.import 검사다. */
export default function ImportPage() {
  return <ImportScreen />;
}
