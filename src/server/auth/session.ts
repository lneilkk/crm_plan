import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session-cookie";
import type { StaffRole } from "@/lib/domain/staff";
import { db } from "@/server/db";

/**
 * 서버 세션 — 기획서 10장, T2-1(로그인), T2-3(세션 만료, 나중에).
 *
 * - 로그인하면 무작위 32바이트 토큰(base64url)을 만든다. 원문은 httpOnly 쿠키 "crm_session"으로만 보내고,
 *   DB(session.token_hash)에는 SHA-256만 둔다. DB가 새어도 쿠키를 만들어 낼 수 없다.
 * - 절대 수명 12시간(expires_at). last_seen_at은 1분에 한 번만 갱신한다(요청마다 쓰지 않도록).
 * - 만료·로그아웃(revoked_at)·비활성·잠긴 직원의 세션은 무효다.
 * - 15분 무조작 만료와 동시 세션 제한은 T2-3에서 isSessionUsable에 조건을 더한다.
 */

export const SESSION_ABSOLUTE_LIFETIME_MS = 12 * 60 * 60 * 1000;
export const SESSION_TOUCH_INTERVAL_MS = 60 * 1000;

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type SessionStaff = {
  id: string;
  role: StaffRole;
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
export function sessionTokenFrom(request: Request): string | null {
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
  staff: { isActive: boolean; lockedAt: Date | null };
};

/** 세션을 아직 쓸 수 있는지. T2-3(무조작 만료)은 여기에 조건을 더한다. */
function isSessionUsable(session: SessionRow, now: Date): boolean {
  if (session.revokedAt !== null) return false;
  if (session.expiresAt.getTime() <= now.getTime()) return false;
  if (!session.staff.isActive || session.staff.lockedAt !== null) return false;
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
      staff: { select: { id: true, role: true, name: true, loginId: true, isActive: true, lockedAt: true } },
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

  const { id, role, name, loginId } = session.staff;
  return { sessionId: session.id, staff: { id, role, name, loginId } };
}

/** 요청을 보낸 직원. 세션이 없거나 만료·로그아웃·비활성·잠금이면 null */
export async function getSessionStaff(request: Request, now: Date = new Date()): Promise<SessionStaff | null> {
  return (await getActiveSession(request, now))?.staff ?? null;
}

/** 로그아웃. session은 추가 전용 테이블이 아니므로 revoked_at을 UPDATE한다. */
export async function revokeSession(sessionId: string, now: Date): Promise<void> {
  await db.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: now } });
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
