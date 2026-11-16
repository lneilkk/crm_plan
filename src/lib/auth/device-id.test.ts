import { describe, expect, it } from "vitest";
import {
  DEVICE_ID_STORAGE_KEY,
  generateDeviceId,
  getDeviceId,
  INPUT_DEVICE_MAX,
  normalizeInputDevice,
} from "./device-id";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

const throwingStorage = {
  getItem: (): string | null => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("기기 id 형식", () => {
  it('"web-" + 소문자 16진수 12자이고 서버 검사를 통과한다', () => {
    for (let i = 0; i < 50; i += 1) {
      const id = generateDeviceId();
      expect(id).toMatch(/^web-[0-9a-f]{12}$/);
      expect(id.length).toBeLessThanOrEqual(INPUT_DEVICE_MAX);
      expect(normalizeInputDevice(id)).toBe(id);
    }
  });

  it("만들 때마다 다르다", () => {
    expect(new Set(Array.from({ length: 50 }, generateDeviceId)).size).toBe(50);
  });
});

describe("getDeviceId", () => {
  it("저장소에 없으면 만들어 저장하고, 다음에는 같은 값을 돌려준다", () => {
    const storage = memoryStorage();
    const first = getDeviceId(storage);
    expect(storage.map.get(DEVICE_ID_STORAGE_KEY)).toBe(first);
    expect(getDeviceId(storage)).toBe(first);
  });

  it("저장된 값의 형식이 틀리면 새로 만든다", () => {
    const storage = memoryStorage({ [DEVICE_ID_STORAGE_KEY]: "가상 기기" });
    const id = getDeviceId(storage);
    expect(id).toMatch(/^web-[0-9a-f]{12}$/);
    expect(storage.map.get(DEVICE_ID_STORAGE_KEY)).toBe(id);
  });

  it("저장소가 예외를 던지거나 없으면 페이지가 살아 있는 동안 같은 메모리 id를 쓴다", () => {
    const id = getDeviceId(throwingStorage);
    expect(id).toMatch(/^web-[0-9a-f]{12}$/);
    expect(getDeviceId(throwingStorage)).toBe(id);
    expect(getDeviceId(null)).toBe(id);
  });
});

describe("normalizeInputDevice — 서버가 헤더 값을 거르는 규칙", () => {
  it.each([
    ["web-0123456789ab", "web-0123456789ab"],
    ["  front-pc_1:a.b  ", "front-pc_1:a.b"],
    ["a".repeat(80), "a".repeat(64)],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeInputDevice(raw)).toBe(expected);
  });

  it.each([null, undefined, "", "   ", "front pc", "접수 PC", "web/1", "x\u0000y"])("%j → null", (raw) => {
    expect(normalizeInputDevice(raw)).toBeNull();
  });
});
