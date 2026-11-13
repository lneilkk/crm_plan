/**
 * 입력 기기 — visit_status_log.input_device (기획서 6장 "입력 기기").
 *
 * 브라우저마다 무작위 기기 id("web-" + 소문자 16진수 12자)를 하나 만들어 localStorage에 두고,
 * apiFetch가 모든 요청에 x-input-device 헤더로 보낸다. 서버(defineRoute)는 normalizeInputDevice로
 * 걸러 ctx.inputDevice에 담는다. 형식이 틀린 값은 버리고 null로 기록한다.
 *
 * - 기기 id는 사람·환자 정보를 담지 않는 무작위 값이다.
 * - localStorage를 쓸 수 없으면(사생활 보호 창, 차단 등) 페이지가 살아 있는 동안만 쓰는 id를 쓴다.
 */

export const INPUT_DEVICE_HEADER = "x-input-device";
export const INPUT_DEVICE_MAX = 64;
const INPUT_DEVICE_PATTERN = /^[\w.:-]+$/;

export const DEVICE_ID_STORAGE_KEY = "crm_device_id";
const DEVICE_ID_PATTERN = /^web-[0-9a-f]{12}$/;

/** 헤더 값 → 저장할 입력 기기. 앞뒤 공백을 자르고 64자까지, 코드처럼 생긴 값(영문·숫자·_.:-)만 받는다. 그 밖에는 null. */
export function normalizeInputDevice(raw: string | null | undefined): string | null {
  const value = raw?.trim().slice(0, INPUT_DEVICE_MAX);
  return value && INPUT_DEVICE_PATTERN.test(value) ? value : null;
}

/** 새 기기 id: "web-" + crypto.getRandomValues로 만든 소문자 16진수 12자 */
export function generateDeviceId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `web-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

type DeviceStorage = Pick<Storage, "getItem" | "setItem">;

let memoryDeviceId: string | null = null;

function defaultStorage(): DeviceStorage | null {
  // localStorage에 접근하는 것만으로 예외가 나는 브라우저가 있다.
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * 이 브라우저의 기기 id. 저장된 값이 형식에 맞으면 그대로 쓰고, 없거나 틀리면 새로 만들어 저장한다.
 * 저장소를 읽거나 쓰지 못하면 메모리에 둔 id를 쓴다(페이지를 새로 열면 바뀐다).
 */
export function getDeviceId(storage: DeviceStorage | null = defaultStorage()): string {
  if (storage) {
    try {
      const stored = storage.getItem(DEVICE_ID_STORAGE_KEY);
      if (stored && DEVICE_ID_PATTERN.test(stored)) return stored;
      const created = generateDeviceId();
      storage.setItem(DEVICE_ID_STORAGE_KEY, created);
      return created;
    } catch {
      // 아래 메모리 id로
    }
  }
  memoryDeviceId ??= generateDeviceId();
  return memoryDeviceId;
}
