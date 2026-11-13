"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, Suspense, useEffect } from "react";
import { apiFetch, ApiRequestError, type Me, ME_QUERY_KEY } from "@/lib/auth/api-client";
import { NAV_SECTIONS } from "@/lib/auth/permissions";
import { STAFF_ROLE_LABEL } from "@/lib/domain/staff";
import { Button, cn, Spinner } from "@/components/ui";
import { allowsScreen, screenForPath } from "@/lib/auth/screen-registry";
import type { Permission } from "@/lib/auth/permissions";
import { NoPermission } from "@/components/auth/no-permission";

/** 상단 바에 보이는 병원 이름. 병원 설정에 이름 항목이 생기면 그 값으로 바꾼다. */
export const CLINIC_DISPLAY_NAME = "치과 CRM";

/**
 * 로그인 후 화면의 틀: 상단 바(병원 이름, 역할별 메뉴, 직원 이름·역할, 로그아웃).
 * 직원 정보는 GET /api/auth/me로 읽고, 401이면 로그인 화면으로 보낸다.
 * 메뉴를 숨기는 것은 편의일 뿐이다. 실제 차단은 각 API의 권한 검사가 한다.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => apiFetch<Me>("/api/auth/me"),
    staleTime: 60_000,
  });

  const unauthenticated = me.error instanceof ApiRequestError && me.error.status === 401;
  useEffect(() => {
    if (unauthenticated) router.replace("/login");
  }, [unauthenticated, router]);

  const logout = useMutation({
    mutationFn: () => apiFetch("/api/auth/logout", { method: "POST" }),
    onSettled: () => {
      queryClient.clear();
      router.replace("/login");
    },
  });

  if (me.isPending || unauthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner showLabel label="불러오는 중" />
      </div>
    );
  }

  if (me.isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center">
        <p className="text-lg">{me.error.message}</p>
        <Button onClick={() => me.refetch()}>다시 시도</Button>
      </div>
    );
  }

  const staff = me.data;
  const sections = NAV_SECTIONS.filter((section) => staff.navSections.includes(section.key));

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2">
          <Link href={staff.home} className="text-xl font-bold text-blue-800">
            {CLINIC_DISPLAY_NAME}
          </Link>
          <nav aria-label="주 메뉴" className="flex flex-1 flex-wrap gap-1">
            <Suspense fallback={<NavLinks sections={sections} pathname={null} />}>
              <CurrentNavLinks sections={sections} />
            </Suspense>
          </nav>
          <div className="flex items-center gap-3">
            <span className="text-base">
              <span className="font-semibold">{staff.name}</span>{" "}
              <span className="text-slate-500">({STAFF_ROLE_LABEL[staff.role]})</span>
            </span>
            <Link
              href="/account/password"
              className="flex min-h-11 items-center rounded-lg px-3 text-base text-slate-700 hover:bg-slate-100"
            >
              비밀번호 변경
            </Link>
            <Button variant="secondary" onClick={() => logout.mutate()} disabled={logout.isPending}>
              로그아웃
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1 p-4">
        <Suspense fallback={<Spinner showLabel label="불러오는 중" />}>
          <ScreenGate permissions={staff.permissions} home={staff.home}>
            {children}
          </ScreenGate>
        </Suspense>
      </main>
    </div>
  );
}

type Section = (typeof NAV_SECTIONS)[number];

/**
 * 화면 진입 검사 (S-4) — 화면 등록부(SCREENS)에서 이 주소의 화면을 찾아, 권한이 없으면 화면을 그리지 않고 안내만 보인다.
 * 화면 코드가 실행되지 않으므로 데이터 API를 부르지 않고, 가짜 값이 잠깐이라도 보이지 않는다. 실제 차단은 API(403)다.
 */
function ScreenGate({ permissions, home, children }: { permissions: Permission[]; home: string; children: ReactNode }) {
  const screen = screenForPath(usePathname());
  if (screen && !allowsScreen(permissions, screen)) {
    return <NoPermission screen={screen.label} permission={screen.permission} home={home} />;
  }
  return children;
}

// usePathname은 동적 경로(예: /patients/[id])에서 Suspense가 필요하다(Cache Components).
function CurrentNavLinks({ sections }: { sections: Section[] }) {
  return <NavLinks sections={sections} pathname={usePathname()} />;
}

function NavLinks({ sections, pathname }: { sections: Section[]; pathname: string | null }) {
  return sections.map((section) => {
    const active = pathname !== null && (pathname === section.href || pathname.startsWith(`${section.href}/`));
    return (
      <Link
        key={section.key}
        href={section.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-11 items-center rounded-lg px-4 text-base font-semibold",
          active ? "bg-blue-700 text-white" : "text-slate-700 hover:bg-slate-100",
        )}
      >
        {section.label}
      </Link>
    );
  });
}
