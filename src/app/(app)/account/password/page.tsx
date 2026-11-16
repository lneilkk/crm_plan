import type { Metadata } from "next";
import { PasswordForm } from "@/components/account/password-form";

export const metadata: Metadata = { title: "비밀번호 변경 · 치과 CRM" };

// (app)의 다른 화면과 같은 이유로 즉시 이동(instant) 검사에서 뺀다: AppShell이 직원을 확인하기 전에는 이 화면을 그리지 않는다.
export const instant = false;

export default function PasswordPage() {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4">
      <h1 className="text-2xl font-bold text-slate-900">비밀번호 변경</h1>
      <PasswordForm />
    </div>
  );
}
