import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { ROUTE_META, type RouteHandler } from "@/server/api/define-route";

/**
 * 입력 기기 — visit_status_log.input_device (기획서 6장). 브라우저가 요청 헤더 x-input-device로 보낸다.
 *
 * defineRoute의 ctx에는 요청 헤더가 없어서, 라우트 핸들러를 감싸 요청마다 헤더 값을 담아 두고
 * 핸들러 안에서 currentInputDevice()로 꺼낸다. 감싼 함수에도 권한·감사 선언(ROUTE_META)을 그대로 붙인다.
 * (ctx에 입력 기기가 생기면 이 파일은 없앤다.)
 */

export const INPUT_DEVICE_HEADER = "x-input-device";
const MAX_LENGTH = 64;

const store = new AsyncLocalStorage<string | null>();

/** 코드처럼 생긴 값(영문·숫자·-_.:)만 받는다. 그 밖의 값은 버린다. */
function readInputDevice(request: Request): string | null {
  const value = request.headers.get(INPUT_DEVICE_HEADER)?.trim().slice(0, MAX_LENGTH);
  return value && /^[\w.:-]+$/.test(value) ? value : null;
}

export function withInputDevice(handler: RouteHandler): RouteHandler {
  const wrapped = (request: Request, context?: { params: Promise<unknown> }) =>
    store.run(readInputDevice(request), () => handler(request, context));
  return Object.assign(wrapped, { [ROUTE_META]: handler[ROUTE_META] }) as RouteHandler;
}

export function currentInputDevice(): string | null {
  return store.getStore() ?? null;
}
