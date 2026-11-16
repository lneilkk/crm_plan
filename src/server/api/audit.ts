import "server-only";

import type { AuditResult, Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";

/**
 * 감사 로그 기록 — 기획서 10장(접근 기록), 절대 규칙 4·5.
 *
 * - audit_log는 추가만 한다. 이 모듈에는 INSERT만 있고, 수정·삭제 함수를 만들지 않는다.
 * - detail에는 개수·코드·ID만 넣는다. 이름·전화번호·메모·검색어·비밀번호 같은 입력 원문은 넣지 않는다.
 * - 보통은 defineRoute가 요청마다 한 행을 쓴다. 직접 부르는 곳은 로그인처럼 요청 전에 직원을 모르는 경우뿐이다.
 */

/**
 * 감사 업무 코드. 대문자·숫자·밑줄 (예: "PATIENT_SEARCH", "STAFF_UNLOCK").
 * 소문자가 섞인 문자열은 타입에서 걸러지고, 형식은 routes.test.ts가 한 번 더 검사한다.
 */
export type AuditAction = Uppercase<string>;

export const AUDIT_ACTION_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/** detail에 넣을 수 있는 값: 개수·코드·ID·참거짓만 */
export type AuditDetail = Record<string, number | string | boolean | null>;

export type AuditEntry = {
  staffId: string | null;
  action: AuditAction;
  result: AuditResult;
  patientId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  detail?: AuditDetail;
};

/** db 또는 트랜잭션 안의 클라이언트. 다른 쓰기와 한 트랜잭션으로 묶을 때 넘긴다. */
type AuditClient = Pick<Prisma.TransactionClient, "auditLog">;

export async function writeAudit(entry: AuditEntry, client: AuditClient = db): Promise<void> {
  await client.auditLog.create({
    data: {
      staffId: entry.staffId,
      action: entry.action,
      result: entry.result,
      patientId: entry.patientId ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
      detail: entry.detail ?? {},
    },
  });
}
