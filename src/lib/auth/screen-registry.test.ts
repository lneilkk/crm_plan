import { describe, expect, it } from "vitest";
import { DIRECTOR_EXTRA_PERMISSIONS, INITIAL_JOB_PERMISSIONS, type Permission, PERMISSION_NAMES, permissionsOf } from "./permissions";
import {
  APPOINTMENT_DETAIL_SECTIONS,
  type AppointmentDetailSection,
  allowsArea,
  allowsScreen,
  HOME_CHOICES,
  homeFor,
  INITIAL_DEPARTMENT_HOMES,
  SCREEN_AREA_NAMES,
  SCREEN_AREAS,
  detailSectionsFor,
  type ScreenArea,
  SCREENS,
  screenForPath,
} from "./screen-registry";

describe("화면 등록부", () => {
  it("모든 영역은 있는 권한을 가리킨다", () => {
    for (const area of SCREEN_AREA_NAMES) expect(PERMISSION_NAMES).toContain(SCREEN_AREAS[area].permission);
  });

  it("영역은 그 권한이 있을 때만 허용", () => {
    expect(allowsArea(["patient.write"], "patients.create")).toBe(true);
    expect(allowsArea(["patient.read"], "patients.create")).toBe(false);
    expect(allowsArea(["appointment.write"], "appointment.price")).toBe(false);
    expect(allowsArea(["appointment.price"], "appointment.price")).toBe(true);
  });

  it("등록부에 없는 영역은 거부", () => {
    expect(allowsArea([...PERMISSION_NAMES], "admin.everything" as ScreenArea)).toBe(false);
    expect(allowsArea([...PERMISSION_NAMES], "constructor" as ScreenArea)).toBe(false);
  });
});

describe("화면(페이지) 등록부 — S-4", () => {
  it("로그인 후 화면의 모든 page.tsx가 등록되어 있다 (새 화면을 만들면 여기서 실패)", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const { join, relative, sep } = await import("node:path");
    const root = join(process.cwd(), "src/app/(app)");
    const pages = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return pages(full);
        return name === "page.tsx" ? ["/" + relative(root, dir).split(sep).join("/")] : [];
      });
    expect(SCREENS.map((s) => s.path).sort()).toEqual(pages(root).sort());
  });

  it("주소 → 화면: 고정 경로와 [id] 경로", () => {
    expect(screenForPath("/patients/new")?.path).toBe("/patients/new");
    expect(screenForPath("/patients/0195f3b0-0000-7000-8000-000000000000")?.path).toBe("/patients/[id]");
    expect(screenForPath("/stats")?.path).toBe("/stats");
    expect(screenForPath("/stats/")?.path).toBe("/stats");
    expect(screenForPath("/nothing")).toBeNull();
  });

  it("화면은 그 권한이 있을 때만, 비밀번호 변경은 로그인만 하면", () => {
    const stats = screenForPath("/stats")!;
    expect(allowsScreen(["stats.read"], stats)).toBe(true);
    expect(allowsScreen(["patient.read"], stats)).toBe(false);
    expect(allowsScreen([], screenForPath("/account/password")!)).toBe(true);
    expect(allowsScreen(["patient.read"], screenForPath("/patients/new")!)).toBe(false);
  });
});

describe("부서별 첫 화면 — S-4 (설정값, 프로그램은 초기값만)", () => {
  const FRONT = ["patient.read", "patient.write", "appointment.read", "appointment.write", "visit.write", "settings.read", "staff.read", "surgery.record"] as const;

  it("초기값: 프론트 내원 보드, 상담 상담, 진료 예약 캘린더(일 보기), 운영 통계 — 모두 첫 화면으로 고를 수 있는 화면", () => {
    expect(INITIAL_DEPARTMENT_HOMES).toEqual({ FRONT: "/board", CONSULT: "/consult", CLINICAL: "/calendar", OPERATIONS: "/stats" });
    for (const home of Object.values(INITIAL_DEPARTMENT_HOMES)) expect(HOME_CHOICES).toContain(home);
  });

  it("설정한 첫 화면을 쓴다", () => {
    expect(homeFor("FRONT", { FRONT: "/calendar" }, [...FRONT])).toBe("/calendar");
  });

  it("설정이 없거나, 고를 수 없는 주소거나, 권한이 없는 화면이면 메뉴의 첫 화면으로", () => {
    expect(homeFor("FRONT", {}, [...FRONT])).toBe("/board");
    expect(homeFor("FRONT", { FRONT: "javascript:alert(1)" }, [...FRONT])).toBe("/board");
    expect(homeFor("FRONT", { FRONT: "/stats" }, [...FRONT])).toBe("/board");
    expect(homeFor("FRONT", { FRONT: 42 }, [...FRONT])).toBe("/board");
  });

  it("볼 수 있는 메뉴가 하나도 없으면 비밀번호 변경 화면", () => {
    expect(homeFor("CLINICAL", { CLINICAL: "/calendar" }, [])).toBe("/account/password");
  });
});

describe("예약 상세 영역 — S-5 (부서·직무별 표, docs/SCREEN_MAP.md 8장과 같아야 한다)", () => {
  // 첫 설치 값 기준. 원장 = 의사 직무 + 추가 권한(DIRECTOR_EXTRA_PERMISSIONS)
  const TABLE: Record<string, { permissions: readonly Permission[]; surgery: AppointmentDetailSection[] }> = {
    "프론트": { permissions: permissionsOf({ jobPermissions: INITIAL_JOB_PERMISSIONS.FRONT, extraPermissions: [] }), surgery: ["기본 정보", "수술 참여 직원"] },
    "상담": { permissions: permissionsOf({ jobPermissions: INITIAL_JOB_PERMISSIONS.COUNSELOR, extraPermissions: [] }), surgery: ["기본 정보", "상담·할인", "수술 참여 직원"] },
    "진료 — 원장": {
      permissions: permissionsOf({ jobPermissions: INITIAL_JOB_PERMISSIONS.DOCTOR, extraPermissions: DIRECTOR_EXTRA_PERMISSIONS }),
      surgery: ["기본 정보", "상담·할인", "수술 참여 직원", "수술 메모"],
    },
    "진료 — 의사(추가 권한 없음)": { permissions: permissionsOf({ jobPermissions: INITIAL_JOB_PERMISSIONS.DOCTOR, extraPermissions: [] }), surgery: ["기본 정보", "수술 참여 직원", "수술 메모"] },
    "진료 — 간호": { permissions: permissionsOf({ jobPermissions: INITIAL_JOB_PERMISSIONS.NURSE, extraPermissions: [] }), surgery: ["기본 정보", "수술 참여 직원"] },
    "운영": { permissions: permissionsOf({ jobPermissions: INITIAL_JOB_PERMISSIONS.ADMIN, extraPermissions: [] }), surgery: ["기본 정보", "상담·할인", "수술 참여 직원", "수술 메모"] },
  };

  it("고가 항목(수술) 예약에서 보이는 영역이 표와 같다", () => {
    for (const [who, row] of Object.entries(TABLE)) expect(detailSectionsFor(row.permissions, true), who).toEqual(row.surgery);
  });

  it("일반 예약에서는 수술 영역이 없다", () => {
    for (const [who, row] of Object.entries(TABLE)) {
      expect(detailSectionsFor(row.permissions, false), who).toEqual(row.surgery.filter((name) => !name.startsWith("수술")));
    }
  });

  it("영역은 등록부의 영역 이름을 가리키고, 권한이 없으면 기본 정보도 없다", () => {
    for (const section of APPOINTMENT_DETAIL_SECTIONS) expect(SCREEN_AREA_NAMES).toContain(section.area);
    expect(detailSectionsFor([], true)).toEqual([]);
  });
});
