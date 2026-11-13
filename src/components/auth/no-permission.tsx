import Link from "next/link";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";

/**
 * "권한 없음" 안내 (S-4) — 권한이 없는 화면 주소로 들어왔을 때 화면 대신 이것만 보인다.
 * 화면 코드를 실행하지 않으므로 데이터 API를 부르지 않고, 가짜 값(0 등)도 그리지 않는다.
 */
export function NoPermission({ screen, permission, home }: { screen: string; permission: Permission | null; home: string }) {
  return (
    <section role="alert" aria-labelledby="no-permission-title" className="mx-auto mt-8 max-w-xl rounded-xl border border-slate-300 bg-white p-6 text-center">
      <h1 id="no-permission-title" className="text-xl font-bold text-slate-900">
        이 화면을 볼 권한이 없습니다
      </h1>
      <p className="mt-2 text-base text-slate-700">
        {screen}
        {permission && ` — 필요한 권한: ${PERMISSIONS[permission]}`}. 필요하면 관리자에게 요청하세요.
      </p>
      <Link href={home} className="mt-4 inline-block text-lg font-semibold text-blue-800 underline">
        첫 화면으로
      </Link>
    </section>
  );
}
