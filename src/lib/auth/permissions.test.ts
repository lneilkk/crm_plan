import { describe, expect, it } from "vitest";
import { STAFF_ROLES, type StaffRole } from "@/lib/domain/staff";
import {
  DEPARTMENT_NAMES,
  DEPARTMENTS,
  departmentOf,
  hasPermission,
  JOB_PERMISSIONS,
  LEGACY_ROLE_EXTRAS,
  navSectionsFor,
  PERMISSION_NAMES,
  type Permission,
  permissionsOf,
} from "./permissions";

/**
 * S-2 이전의 역할 × 권한 표(2026-11-13, 커밋 47d66b6의 permissions.ts)를 그대로 얼려 둔 것.
 * "변환 전후 사람별 권한이 같다"는 완료 기준을 이 표로 증명한다. 이 표는 고치지 않는다.
 */
//                                         FRONT  COUNSELOR DOCTOR NURSE  ADMIN
const LEGACY: Record<Permission, [boolean, boolean, boolean, boolean, boolean]> = {
  "patient.read": /*            */ [true, true, true, true, true],
  "patient.write": /*           */ [true, true, false, false, true],
  "appointment.read": /*        */ [true, true, true, true, true],
  "appointment.write": /*       */ [true, true, false, false, true],
  "visit.write": /*             */ [true, true, false, true, true],
  "stats.read": /*              */ [false, false, true, false, true],
  "settings.read": /*           */ [true, true, true, true, true],
  "settings.write": /*          */ [false, false, false, false, true],
  "staff.read": /*              */ [true, true, true, true, true],
  "staff.manage": /*            */ [false, false, false, false, true],
  "consult.read": /*            */ [false, true, true, false, true],
  "consult.write": /*           */ [false, true, false, false, true],
  "surgery.record": /*          */ [true, true, true, true, true],
  "surgery.note": /*            */ [false, false, true, false, true],
  "data.import": /*             */ [false, false, false, false, true],
};
const ROLE_ORDER: StaffRole[] = ["FRONT", "COUNSELOR", "DOCTOR", "NURSE", "ADMIN"];
const legacySetOf = (role: StaffRole) =>
  PERMISSION_NAMES.filter((permission) => LEGACY[permission][ROLE_ORDER.indexOf(role)]);

describe("권한 목록", () => {
  it("S-2 전과 같은 권한 15개, 역할 5개", () => {
    expect([...PERMISSION_NAMES].sort()).toEqual(Object.keys(LEGACY).sort());
    expect([...ROLE_ORDER].sort()).toEqual([...STAFF_ROLES].sort());
  });
});

describe("부서와 직무", () => {
  it("부서는 프론트·상담·진료·운영 4개이고, 직무는 정확히 한 부서에 속한다", () => {
    expect(DEPARTMENT_NAMES).toEqual(["FRONT", "CONSULT", "CLINICAL", "OPERATIONS"]);
    expect(DEPARTMENT_NAMES.map((d) => DEPARTMENTS[d].label)).toEqual(["프론트", "상담", "진료", "운영"]);
    const jobs = DEPARTMENT_NAMES.flatMap((d) => DEPARTMENTS[d].jobs);
    expect([...jobs].sort()).toEqual([...STAFF_ROLES].sort());
  });

  it("의사·간호는 진료, 관리자는 운영", () => {
    expect(departmentOf("FRONT")).toBe("FRONT");
    expect(departmentOf("COUNSELOR")).toBe("CONSULT");
    expect(departmentOf("DOCTOR")).toBe("CLINICAL");
    expect(departmentOf("NURSE")).toBe("CLINICAL");
    expect(departmentOf("ADMIN")).toBe("OPERATIONS");
  });

  it("의사 직무 기본값에는 통계·상담 보기가 없다 — 원장에게만 개인 추가 권한으로 준다", () => {
    expect(JOB_PERMISSIONS.DOCTOR).not.toContain("stats.read");
    expect(JOB_PERMISSIONS.DOCTOR).not.toContain("consult.read");
    expect(JOB_PERMISSIONS.DOCTOR).toContain("surgery.note");
  });
});

describe("변환 전후 사람별 권한이 같다 (S-2 완료 기준)", () => {
  for (const role of ROLE_ORDER) {
    it(`${role}: 직무 기본값 + 변환 때 준 추가 권한 = S-2 전 권한`, () => {
      expect(permissionsOf({ role, extraPermissions: LEGACY_ROLE_EXTRAS[role] })).toEqual(legacySetOf(role));
    });
  }

  for (const permission of PERMISSION_NAMES) {
    ROLE_ORDER.forEach((role, index) => {
      const expected = LEGACY[permission][index];
      it(`${role} × ${permission} → ${expected ? "허용" : "거부"}`, () => {
        expect(hasPermission({ role, extraPermissions: LEGACY_ROLE_EXTRAS[role] }, permission)).toBe(expected);
      });
    });
  }

  it("변환 때 준 추가 권한은 직무 기본값과 겹치지 않는다 (필요한 것만 줌)", () => {
    for (const role of ROLE_ORDER) {
      for (const extra of LEGACY_ROLE_EXTRAS[role]) expect(JOB_PERMISSIONS[role]).not.toContain(extra);
    }
  });

  it("메뉴도 S-2 전과 같다", () => {
    const menu = (role: StaffRole) => navSectionsFor({ role, extraPermissions: LEGACY_ROLE_EXTRAS[role] });
    expect(menu("FRONT")).toEqual(["board", "calendar", "patients"]);
    expect(menu("COUNSELOR")).toEqual(["board", "calendar", "consult", "patients"]);
    expect(menu("DOCTOR")).toEqual(["board", "calendar", "consult", "patients", "stats"]);
    expect(menu("NURSE")).toEqual(["board", "calendar", "patients"]);
    expect(menu("ADMIN")).toEqual(["board", "calendar", "consult", "patients", "stats", "import"]);
  });
});

describe("개인 추가 권한", () => {
  it("추가 권한은 직무 기본값에 더해진다", () => {
    expect(hasPermission({ role: "NURSE", extraPermissions: [] }, "stats.read")).toBe(false);
    expect(hasPermission({ role: "NURSE", extraPermissions: ["stats.read"] }, "stats.read")).toBe(true);
    expect(navSectionsFor({ role: "DOCTOR", extraPermissions: [] })).toEqual(["board", "calendar", "patients"]);
  });

  it("모르는 이름은 무시하고(기본 거부), 겹친 것은 한 번만, 순서는 권한 목록 순서", () => {
    const result = permissionsOf({ role: "FRONT", extraPermissions: ["patient.delete", "stats.read", "stats.read", "constructor"] });
    expect(result).toContain("stats.read");
    expect(result.filter((p) => p === "stats.read")).toHaveLength(1);
    expect(result).not.toContain("patient.delete");
    expect(result).toEqual(PERMISSION_NAMES.filter((p) => result.includes(p)));
  });

  it("표에 없는 권한·직무는 거부한다", () => {
    expect(hasPermission({ role: "ADMIN", extraPermissions: [] }, "patient.delete" as Permission)).toBe(false);
    expect(hasPermission({ role: "OWNER" as StaffRole, extraPermissions: [] }, "patient.read")).toBe(false);
    expect(hasPermission({ role: "OWNER" as StaffRole, extraPermissions: ["patient.read"] }, "patient.read")).toBe(false);
    expect(hasPermission({ role: "ADMIN", extraPermissions: [] }, "constructor" as Permission)).toBe(false);
    expect(permissionsOf({ role: "OWNER" as StaffRole, extraPermissions: ["stats.read"] })).toEqual([]);
  });
});
