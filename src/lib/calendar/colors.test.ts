import { describe, expect, it } from "vitest";
import { APPOINTMENT_STATUSES } from "@/lib/domain/appointment";
import {
  DEFAULT_STATUS_STYLES,
  isHexColor,
  readableTextColor,
  representativeLabel,
  resolveStatusStyles,
} from "./colors";

describe("isHexColor", () => {
  it("#RRGGBB만 받는다", () => {
    expect(isHexColor("#1E73E8")).toBe(true);
    expect(isHexColor("#abcdef")).toBe(true);
    expect(isHexColor("#abc")).toBe(false);
    expect(isHexColor("1E73E8")).toBe(false);
    expect(isHexColor("#1E73E8; background:url(x)")).toBe(false);
    expect(isHexColor("red")).toBe(false);
  });
});

describe("readableTextColor", () => {
  it("밝은 바탕에는 검은 글씨, 어두운 바탕에는 흰 글씨", () => {
    expect(readableTextColor("#FFF59D")).toBe("#000000"); // 연노랑
    expect(readableTextColor("#F2E21B")).toBe("#000000"); // 노랑(200)
    expect(readableTextColor("#111111")).toBe("#FFFFFF");
    expect(readableTextColor("#1A0DAB")).toBe("#FFFFFF"); // 남색
    expect(readableTextColor("#1E73E8")).toBe("#FFFFFF"); // 파랑
  });
});

describe("representativeLabel", () => {
  const labels = [
    { id: "a", name: "100", color: "#A98BD6", sortOrder: 0, isActive: true },
    { id: "b", name: "초진", color: "#1E73E8", sortOrder: 4, isActive: true },
    { id: "c", name: "vip", color: "#8FB0CC", sortOrder: 3, isActive: false },
  ];

  it("붙은 라벨 중 순서가 가장 위(sortOrder 최소)인 라벨", () => {
    expect(representativeLabel(["b", "a"], labels)?.id).toBe("a");
    expect(representativeLabel(["b", "c"], labels)?.id).toBe("c"); // 숨긴 라벨도 이미 붙어 있으면 색에 쓴다
  });

  it("라벨이 없거나 모르는 id뿐이면 null", () => {
    expect(representativeLabel([], labels)).toBeNull();
    expect(representativeLabel(["zzz"], labels)).toBeNull();
  });
});

describe("resolveStatusStyles", () => {
  it("모든 상태에 기본 표시 이름·색이 있다", () => {
    for (const status of APPOINTMENT_STATUSES) {
      expect(DEFAULT_STATUS_STYLES[status].name.length).toBeGreaterThan(0);
      expect(isHexColor(DEFAULT_STATUS_STYLES[status].color)).toBe(true);
    }
  });

  it("저장된 값이 없거나 깨졌으면 기본값, 일부만 있으면 그 상태만 바꾼다", () => {
    expect(resolveStatusStyles(null)).toEqual(DEFAULT_STATUS_STYLES);
    expect(resolveStatusStyles("broken")).toEqual(DEFAULT_STATUS_STYLES);
    const resolved = resolveStatusStyles({ ARRIVED: { name: "내원", color: "#000000" }, NO_SHOW: { name: "", color: "bad" } });
    expect(resolved.ARRIVED).toEqual({ name: "내원", color: "#000000" });
    expect(resolved.NO_SHOW).toEqual(DEFAULT_STATUS_STYLES.NO_SHOW);
    expect(resolved.BOOKED).toEqual(DEFAULT_STATUS_STYLES.BOOKED);
  });
});
