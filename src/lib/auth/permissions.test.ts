import { describe, expect, it } from "vitest";
import { STAFF_ROLES, type StaffRole } from "@/lib/domain/staff";
import { can, navSectionsFor, PERMISSION_NAMES, type Permission } from "./permissions";

// 기대값 표 — 권한 × 역할. 표(PERMISSIONS)를 고치면 이 표도 같이 고쳐야 테스트가 통과한다.
//                                  FRONT  COUNSELOR DOCTOR ADMIN
const EXPECTED: Record<Permission, [boolean, boolean, boolean, boolean]> = {
  "patient.read": /*            */ [true, true, true, true],
  "patient.write": /*           */ [true, true, false, true],
  "appointment.read": /*        */ [true, true, true, true],
  "appointment.write": /*       */ [true, true, false, true],
  "visit.write": /*             */ [true, true, false, true],
  "stats.read": /*              */ [false, false, true, true],
  "settings.read": /*           */ [true, true, true, true],
  "settings.write": /*          */ [false, false, false, true],
  "staff.read": /*              */ [true, true, true, true],
  "staff.manage": /*            */ [false, false, false, true],
};

const ROLE_ORDER: StaffRole[] = ["FRONT", "COUNSELOR", "DOCTOR", "ADMIN"];

describe("권한 표", () => {
  it("기대값 표와 권한 목록이 같다 (빠지거나 더해진 권한 없음)", () => {
    expect([...PERMISSION_NAMES].sort()).toEqual(Object.keys(EXPECTED).sort());
    expect([...ROLE_ORDER].sort()).toEqual([...STAFF_ROLES].sort());
  });

  for (const permission of Object.keys(EXPECTED) as Permission[]) {
    ROLE_ORDER.forEach((role, index) => {
      const expected = EXPECTED[permission][index];
      it(`${role} × ${permission} → ${expected ? "허용" : "거부"}`, () => {
        expect(can(role, permission)).toBe(expected);
      });
    });
  }

  it("표에 없는 권한·역할은 거부한다", () => {
    expect(can("ADMIN", "patient.delete" as Permission)).toBe(false);
    expect(can("OWNER" as StaffRole, "patient.read")).toBe(false);
    expect(can("ADMIN", "constructor" as Permission)).toBe(false);
  });
});

describe("메뉴 구역", () => {
  it("통계는 의사·관리자만, 나머지 구역은 모든 역할이 본다", () => {
    expect(navSectionsFor("FRONT")).toEqual(["board", "calendar", "patients"]);
    expect(navSectionsFor("COUNSELOR")).toEqual(["board", "calendar", "patients"]);
    expect(navSectionsFor("DOCTOR")).toEqual(["board", "calendar", "patients", "stats"]);
    expect(navSectionsFor("ADMIN")).toEqual(["board", "calendar", "patients", "stats"]);
  });
});
