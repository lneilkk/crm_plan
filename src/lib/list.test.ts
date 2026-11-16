import { describe, expect, it } from "vitest";
import { moveItem } from "./list";

describe("moveItem — 목록 편집기의 ▲▼ (S-6)", () => {
  it("위로·아래로 한 칸", () => {
    expect(moveItem(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
  });
  it("맨 위에서 위로, 맨 아래에서 아래로는 그대로(같은 목록)", () => {
    const list = ["a", "b"];
    expect(moveItem(list, 0, -1)).toBe(list);
    expect(moveItem(list, 1, 1)).toBe(list);
    expect(moveItem(list, 5, -1)).toBe(list);
  });
  it("원래 목록을 바꾸지 않는다", () => {
    const list = ["a", "b"];
    moveItem(list, 0, 1);
    expect(list).toEqual(["a", "b"]);
  });
});
