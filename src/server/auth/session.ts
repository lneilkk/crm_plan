import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session-cookie";
import type { StaffRole } from "@/lib/domain/staff";
import { db, type DbClient } from "@/server/db";
import type { Permission } from "@/lib/auth/permissions";
import { loadPermissions } from "./access";

/**
 * 서버 세션 — 기획서 10장, T2-1(로그인), T2-3(세션 만료, 나중에).
 *
 * - 로그인하면 무작위 32바이트 토큰(base64url)을 만든다. 원문은 httpOnly 쿠키 "crm_session"으로만 보내고,
 *   DB(session.token_hash)에는 SHA-256만 둔다. DB가 새어도 쿠키를 만들어 낼 수 없다.
 * - 절대 수명 12시간(expires_at). last_seen_at은 1분에 한 번만 갱신한다(요청마다 쓰지 않도록).
 * - 만료·로그아웃(revoked_at)·비활성 직원의 세션은 무효다.
 * - 잠금(locked_at, 비밀번호 5회 실패)은 새 로그인만 막고 이미 로그인한 세션은 끊지 않는다(기획서 10장은 잠금만 요구).
 *   누구나 로그인 화면에서 남의 아이디로 5번 틀려 잠글 수 있으므로, 잠금이 세션까지 끊으면 근무 중인 직원과
 *   관리자를 모두 쫓아낼 수 있다(관리자가 모두 잠기면 화면에서 해제할 사람도 없다).
 * - 같은 브라우저에서 다시 로그인하면 쿠키에 있던 이전 세션은 끊는다(login.ts, 공용 PC에서 직원이 바뀌는 경우).
 * - 15분 무조작 만료와 동시 세션 제한은 T2-3에서 isSessionUsable에 조건을 더한다.
 */

export const SESSION_ABSOLUTE_LIFETIME_MS = 12 * 60 * 60 * 1000;
export const SESSION_TOUCH_INTERVAL_MS = 60 * 1000;

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type SessionStaff = {
  id: string;
  role: StaffRole;
  /** 이 사람의 권한 = DB 직무 권한 ∪ 개인 추가 권한. 요청마다 새로 계산한다 (src/server/auth/access.ts) */
  permissions: Permission[];
  name: string;
  loginId: string;
};

export type ActiveSession = {
  sessionId: string;
  staff: SessionStaff;
};

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 새 세션을 만들고 쿠키에 넣을 토큰 원문을 돌려준다. 토큰은 로그·응답 본문에 넣지 않는다. */
export async function createSession(
  staffId: string,
  meta: { ip: string | null; userAgent: string | null; now: Date },
): Promise<{ sessionId: string; token: string; expiresAt: Date }> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(meta.now.getTime() + SESSION_ABSOLUTE_LIFETIME_MS);
  const session = await db.session.create({
    data: {
      tokenHash: hashSessionToken(token),
      staffId,
      createdAt: meta.now,
      lastSeenAt: meta.now,
      expiresAt,
      ip: meta.ip,
      userAgent: meta.userAgent,
    },
    select: { id: true },
  });
  return { sessionId: session.id, token, expiresAt };
}

/** 요청의 Cookie 헤더에서 세션 토큰을 꺼낸다. 형식이 틀리면 null */
export function sessionTokenFrom(request: { headers: Headers }): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== SESSION_COOKIE_NAME) continue;
    const value = part.slice(index + 1).trim();
    return TOKEN_PATTERN.test(value) ? value : null;
  }
  return null;
}

type SessionRow = {
  expiresAt: Date;
  revokedAt: Date | null;
  staff: { isActive: boolean };
};

/** 세션을 아직 쓸 수 있는지. 잠금은 보지 않는다(위 설명). T2-3(무조작 만료)은 여기에 조건을 더한다. */
export function isSessionUsable(session: SessionRow, now: Date): boolean {
  if (session.revokedAt !== null) return false;
  if (session.expiresAt.getTime() <= now.getTime()) return false;
  if (!session.staff.isActive) return false;
  return true;
}

/** 요청의 세션과 직원. 세션이 없거나 무효면 null */
export async function getActiveSession(request: Request, now: Date = new Date()): Promise<ActiveSession | null> {
  const token = sessionTokenFrom(request);
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      lastSeenAt: true,
      staff: { select: { id: true, role: true, extraPermissions: true, name: true, loginId: true, isActive: true } },
    },
  });
  if (!session || !isSessionUsable(session, now)) return null;

  if (now.getTime() - session.lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS) {
    // 동시에 들어온 요청이 여러 번 쓰지 않도록 조건부로 갱신한다.
    await db.session.updateMany({
      where: { id: session.id, lastSeenAt: { lte: new Date(now.getTime() - SESSION_TOUCH_INTERVAL_MS) } },
      data: { lastSeenAt: now },
    });
  }

  const { id, role, extraPermissions, name, loginId } = session.staff;
  const permissions = await loadPermissions({ role, extraPermissions });
  return { sessionId: session.id, staff: { id, role, permissions, name, loginId } };
}

/** 요청을 보낸 직원. 세션이 없거나 만료·로그아웃·비활성이면 null */
export async function getSessionStaff(request: Request, now: Date = new Date()): Promise<SessionStaff | null> {
  return (await getActiveSession(request, now))?.staff ?? null;
}

/** 로그아웃. session은 추가 전용 테이블이 아니므로 revoked_at을 UPDATE한다. */
export async function revokeSession(sessionId: string, now: Date, client: DbClient = db): Promise<void> {
  await client.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: now } });
}

/** 토큰 원문으로 세션을 끊는다(다시 로그인할 때 쿠키에 있던 이전 세션). 끊었으면 true */
export async function revokeSessionByToken(token: string, now: Date, client: DbClient = db): Promise<boolean> {
  const { count } = await client.session.updateMany({
    where: { tokenHash: hashSessionToken(token), revokedAt: null },
    data: { revokedAt: now },
  });
  return count > 0;
}

function cookieAttributes(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax${secure}`;
}

/** 로그인 응답의 Set-Cookie 값 */
export function sessionCookieHeader(token: string, expiresAt: Date): string {
  return `${SESSION_COOKIE_NAME}=${token}; ${cookieAttributes()}; Expires=${expiresAt.toUTCString()}`;
}

/** 로그아웃 응답의 Set-Cookie 값 (쿠키 지우기) */
export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; ${cookieAttributes()}; Max-Age=0`;
}
