import "server-only";

import { z } from "zod";
import type { AuditResult } from "@/generated/prisma/client";
import { INPUT_DEVICE_HEADER, normalizeInputDevice } from "@/lib/auth/device-id";
import { hasPermission, type Permission } from "@/lib/auth/permissions";
import { getActiveSession, type SessionStaff } from "@/server/auth/session";
import { db, type DbClient } from "@/server/db";
import { errorFields, log } from "@/server/log";
import { type AuditAction, type AuditDetail, writeAudit } from "./audit";
import { clientIp } from "./client-ip";
import { ApiError, apiErrorResponse, errorResponse, INTERNAL_ERROR_MESSAGE } from "./errors";

/**
 * API 공통 계층 — T2-4. src/app/api/**\/route.ts의 모든 HTTP 메서드는 이 함수로 만든다.
 *
 *   export const GET = defineRoute({
 *     permission: "patient.read",      // 필수. 권한 이름, "public"(세션 없음), "authenticated"(로그인한 직원 누구나)
 *     audit: "PATIENT_SEARCH",         // 필수. audit_log에 남길 업무 코드, 또는 "none"(환자 정보를 다루지 않는 API만)
 *     query: z.object({ q: z.string() }),
 *     handler: async (ctx) => { ...; ctx.touchPatients(ids); return { items } },
 *   });
 *
 * 순서: CSRF(GET 외) → 세션 → 권한(기본 거부) → 입력 검증 → 핸들러 → 감사 로그.
 * - 세션이 없으면 401 UNAUTHENTICATED, 권한이 없으면 403 FORBIDDEN + DENIED 감사 행.
 * - audit가 "none"이 아니면 요청마다 감사 행을 정확히 한 개 쓴다(성공 SUCCESS, 검증·핸들러 실패 FAILED).
 *   patient_id는 ctx.touchPatients로 알린 환자가 정확히 한 명일 때만 채우고, detail은 { patientCount, ...ctx.audit(…) }.
 *   감사 행을 쓰지 못하면 응답하지 않고 500을 돌려준다(기록 없는 환자 정보 조회를 막기 위해).
 * - 쓰기 요청(GET·HEAD 외)이고 audit가 "none"이 아니면 핸들러를 트랜잭션 안에서 부르고, 핸들러가 돌려준 결과의
 *   감사 행도 같은 트랜잭션에서 쓴다. 핸들러는 DB 쓰기를 모두 ctx.db로 해야 한다. 감사 행을 쓰지 못하면 변경도
 *   함께 취소된다(기록 없는 환자 정보 변경을 막기 위해). 핸들러가 던지면 변경은 취소되고 FAILED 행은 트랜잭션 밖에서 쓴다.
 * - 요청 본문은 MAX_BODY_BYTES까지만 읽는다. 넘으면 413 PAYLOAD_TOO_LARGE (로그인처럼 세션 없이 부르는 API도 보호).
 * - 핸들러는 ctx.now(서버 시각)를 쓴다. 브라우저가 보낸 시각을 믿지 않는다.
 * - 처리하지 못한 에러는 500과 일반 문구로 바꾸고, 로그에는 에러 이름·코드만 남긴다.
 * - src/server/api/routes.test.ts가 모든 route.ts의 메서드가 이 함수로 만들어졌는지 검사한다.
 */

export type RoutePermission = Permission | "public" | "authenticated";

export type { DbClient };

/** 요청 본문 상한 (바이트). 가장 큰 입력(고객 메모 등)보다 넉넉하다. */
export const MAX_BODY_BYTES = 64 * 1024;

type Schema = z.ZodType;
type Output<S> = S extends Schema ? z.output<S> : undefined;

export type RouteContext<P extends RoutePermission, Q, B, Pa> = {
  /** 요청한 직원. permission이 "public"일 때만 null */
  staff: P extends "public" ? null : SessionStaff;
  /** 요청의 세션 id (로그아웃용). "public"이면 null */
  sessionId: P extends "public" ? null : string;
  query: Output<Q>;
  body: Output<B>;
  params: Pa extends Schema ? z.output<Pa> : Record<string, string | string[] | undefined>;
  /** 요청 헤더 (쿠키 등). 값을 감사 행·로그에 넣지 않는다. */
  headers: Headers;
  /**
   * 이 요청에서 쓸 DB 클라이언트. 감사 대상 쓰기 요청이면 감사 행과 한 트랜잭션이므로
   * 서비스에 꼭 이 값을 넘긴다(전역 db를 쓰면 감사 행 없이 변경이 남을 수 있다).
   */
  db: DbClient;
  ip: string | null;
  userAgent: string | null;
  /** 입력 기기 — 요청 헤더 x-input-device(apiFetch가 붙임). 형식이 틀리거나 없으면 null (normalizeInputDevice) */
  inputDevice: string | null;
  /** 서버 시각. 핸들러는 이 값만 쓴다. */
  now: Date;
  /** 응답에 담기거나 바뀐 환자 id를 알린다. 감사 행의 patientCount·patient_id가 된다. */
  touchPatients(ids: readonly string[]): void;
  /** 감사 행 detail에 덧붙일 개수·코드 (원문 금지) */
  audit(extra: AuditDetail): void;
};

export type RouteDefinition<P extends RoutePermission, Q, B, Pa> = {
  permission: P;
  audit: AuditAction | "none";
  query?: Q;
  body?: B;
  params?: Pa;
  /** 요청 본문 상한(바이트). 기본 MAX_BODY_BYTES. 대량 입력(가져오기)만 늘린다 — 권한 검사를 통과한 뒤에만 읽는다. */
  maxBodyBytes?: number;
  handler: (ctx: RouteContext<P, Q, B, Pa>) => unknown;
};

export type RouteMeta = { permission: RoutePermission; audit: AuditAction | "none" };

/** defineRoute로 만든 핸들러에 붙는 표시. routes.test.ts가 이것으로 알아본다. */
export const ROUTE_META: unique symbol = Symbol.for("crm.api.defineRoute");

export type RouteHandler = ((request: Request, context?: { params: Promise<unknown> }) => Promise<Response>) & {
  readonly [ROUTE_META]: RouteMeta;
};

const SAFE_METHODS = new Set(["GET", "HEAD"]);
const USER_AGENT_MAX = 512;

export function defineRoute<
  P extends RoutePermission,
  Q extends Schema | undefined = undefined,
  B extends Schema | undefined = undefined,
  Pa extends Schema | undefined = undefined,
>(definition: RouteDefinition<P, Q, B, Pa>): RouteHandler {
  const meta: RouteMeta = Object.freeze({ permission: definition.permission, audit: definition.audit });

  const handle = async (request: Request, context?: { params: Promise<unknown> }): Promise<Response> => {
    const now = new Date();
    const ip = clientIp(request);
    const userAgent = request.headers.get("user-agent")?.slice(0, USER_AGENT_MAX) ?? null;
    const method = request.method.toUpperCase();

    try {
      if (!SAFE_METHODS.has(method) && isCrossSiteRequest(request)) {
        throw new ApiError(403, "CSRF", "허용되지 않은 출처의 요청입니다. 화면을 새로 고친 뒤 다시 시도하세요.");
      }

      let staff: SessionStaff | null = null;
      let sessionId: string | null = null;
      if (definition.permission !== "public") {
        const session = await getActiveSession(request, now);
        if (!session) throw new ApiError(401, "UNAUTHENTICATED", "로그인이 필요합니다. 다시 로그인하세요.");
        staff = session.staff;
        sessionId = session.sessionId;
        if (definition.permission !== "authenticated" && !hasPermission(staff, definition.permission)) {
          await writeAudit({
            staffId: staff.id,
            action: definition.audit === "none" ? "API_ACCESS" : definition.audit,
            result: "DENIED",
            ip,
            userAgent,
            detail: { permission: definition.permission, method, path: new URL(request.url).pathname },
          });
          throw new ApiError(403, "FORBIDDEN", "이 작업을 할 권한이 없습니다.");
        }
      }

      const touched = new Set<string>();
      const extra: AuditDetail = {};
      const auditRow = (result: AuditResult) => {
        const patientIds = [...touched];
        return {
          staffId: staff?.id ?? null,
          action: definition.audit as AuditAction,
          result,
          patientId: patientIds.length === 1 ? patientIds[0] : null,
          ip,
          userAgent,
          detail: { ...extra, patientCount: patientIds.length },
        };
      };
      // 감사 대상 쓰기 요청: 변경과 감사 행을 한 트랜잭션으로 묶는다.
      const transactional = definition.audit !== "none" && !SAFE_METHODS.has(method);
      let response: Response;
      let audited = false;
      try {
        const input = await parseInput(request, context, definition);
        const run = async (client: DbClient): Promise<Response> => {
          const ctx = {
            staff,
            sessionId,
            ...input,
            headers: request.headers,
            db: client,
            ip,
            userAgent,
            inputDevice: normalizeInputDevice(request.headers.get(INPUT_DEVICE_HEADER)),
            now,
            touchPatients(ids: readonly string[]) {
              for (const id of ids) touched.add(id);
            },
            audit(more: AuditDetail) {
              Object.assign(extra, more);
            },
          } as RouteContext<P, Q, B, Pa>;
          const output = await definition.handler(ctx);
          if (definition.audit === "none" && touched.size > 0) {
            // 환자 정보를 다루면서 감사 코드를 "none"으로 선언한 API — 기록 없이 응답하지 않는다.
            throw new Error("audit none 라우트가 환자를 다뤘습니다");
          }
          return toResponse(output);
        };
        if (transactional) {
          response = await db.$transaction(async (tx) => {
            const out = await run(tx);
            await writeAudit(auditRow(out.status >= 400 ? "FAILED" : "SUCCESS"), tx);
            return out;
          });
          audited = true;
        } else {
          response = await run(db);
        }
      } catch (error) {
        if (error instanceof ApiError) extra.errorCode = error.code;
        response = errorToResponse(error, method, request);
        // 트랜잭션은 취소되었다 — 실패 행은 밖에서 쓴다.
        if (definition.audit !== "none") await writeAudit(auditRow("FAILED"));
        audited = true;
      }

      if (definition.audit !== "none" && !audited) {
        await writeAudit(auditRow(response.status >= 400 ? "FAILED" : "SUCCESS"));
      }
      return response;
    } catch (error) {
      return errorToResponse(error, method, request);
    }
  };

  return Object.assign(handle, { [ROUTE_META]: meta }) as RouteHandler;
}

/** defineRoute로 만든 핸들러면 선언(권한·감사)을, 아니면 null */
export function routeMetaOf(value: unknown): RouteMeta | null {
  if (typeof value !== "function") return null;
  const meta = (value as { [ROUTE_META]?: RouteMeta })[ROUTE_META];
  return meta ?? null;
}

async function parseInput(
  request: Request,
  context: { params: Promise<unknown> } | undefined,
  definition: { query?: Schema; body?: Schema; params?: Schema; maxBodyBytes?: number },
) {
  const rawParams = ((context ? await context.params : undefined) ?? {}) as Record<string, unknown>;
  const params = definition.params ? validate(definition.params, rawParams) : rawParams;

  let query: unknown = undefined;
  if (definition.query) {
    const raw: Record<string, string | string[]> = {};
    for (const [key, value] of new URL(request.url).searchParams) {
      const existing = raw[key];
      raw[key] = existing === undefined ? value : [...(Array.isArray(existing) ? existing : [existing]), value];
    }
    query = validate(definition.query, raw);
  }

  let body: unknown = undefined;
  if (definition.body) {
    const text = await readBodyText(request, definition.maxBodyBytes ?? MAX_BODY_BYTES);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ApiError(400, "INVALID_JSON", "요청 형식이 올바르지 않습니다.");
    }
    body = validate(definition.body, raw);
  }

  return { params, query, body };
}

/**
 * 본문을 limit 바이트까지만 읽는다. Content-Length가 크면 읽지 않고, 길이를 알리지 않은(chunked) 본문은
 * 읽으면서 세다가 넘으면 멈춘다. 둘 다 413 PAYLOAD_TOO_LARGE.
 */
export async function readBodyText(request: Request, limit: number): Promise<string> {
  const tooLarge = () => new ApiError(413, "PAYLOAD_TOO_LARGE", "요청이 너무 큽니다.");
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > limit) throw tooLarge();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** 검증 실패 응답에는 필드 경로와 오류 종류만 담는다. 입력값·zod 메시지는 담지 않는다(값이 섞일 수 있어서). */
function validate(schema: Schema, value: unknown): unknown {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const fields = parsed.error.issues.map((issue) => ({
    path: issue.path.map((part) => String(part)).join("."),
    code: issue.code,
  }));
  throw new ApiError(400, "VALIDATION_FAILED", "입력값을 확인하세요.", { fields });
}

function toResponse(value: unknown): Response {
  if (value instanceof Response) {
    if (!value.headers.has("Cache-Control")) {
      try {
        value.headers.set("Cache-Control", "no-store");
      } catch {
        // 헤더를 바꿀 수 없는 응답은 그대로 둔다.
      }
    }
    return value;
  }
  return Response.json(value ?? null, { headers: { "Cache-Control": "no-store" } });
}

function errorToResponse(error: unknown, method: string, request: Request): Response {
  if (error instanceof ApiError) return apiErrorResponse(error);
  // 메시지에는 입력값이 섞일 수 있으므로 기록하지 않는다(절대 규칙 6).
  log.error("api.unhandled_error", { method, path: new URL(request.url).pathname, ...errorFields(error) });
  return errorResponse(500, "INTERNAL", INTERNAL_ERROR_MESSAGE);
}

/**
 * GET·HEAD가 아닌 요청이 다른 사이트에서 왔는지.
 * Origin이 있고 호스트가 요청 호스트와 다르거나, 브라우저가 Sec-Fetch-Site: cross-site를 보냈으면 거부한다.
 * (세션 쿠키가 SameSite=Lax라 대부분 막히지만, 한 번 더 확인한다.)
 */
export function isCrossSiteRequest(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true; // "null" 같은 불투명 출처
  }
  const requestHost = request.headers.get("host") ?? new URL(request.url).host;
  return originHost.toLowerCase() !== requestHost.toLowerCase();
}
