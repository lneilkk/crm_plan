import { describe, expect, it } from "vitest";
import { PERMISSION_NAMES } from "./permissions";
import { allowsArea, SCREEN_AREA_NAMES, SCREEN_AREAS, type ScreenArea } from "./screen-registry";

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
