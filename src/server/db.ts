import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { type Prisma, PrismaClient } from "@/generated/prisma/client";

/**
 * 앱 전체가 함께 쓰는 Prisma 클라이언트.
 *
 * - Prisma 7은 드라이버 어댑터가 필요하다 → pg(@prisma/adapter-pg).
 * - 접속 주소는 환경변수 DATABASE_URL에서만 읽는다(절대 규칙 2). 주소는 에러 메시지에도 넣지 않는다.
 * - 쿼리 로그를 켜지 않는다: 쿼리 파라미터에 이름·전화번호 같은 환자 정보가 들어 있다(절대 규칙 6).
 * - 개발 서버는 파일을 고칠 때마다 모듈을 다시 읽으므로, globalThis에 두고 재사용해
 *   접속 풀이 계속 늘어나지 않게 한다.
 */

const globalForDb = globalThis as typeof globalThis & { __crmDb?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL 환경변수가 없습니다. .env를 확인하세요 (npm run setup:env).");
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export const db: PrismaClient = globalForDb.__crmDb ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__crmDb = db;
}

/**
 * 서비스가 받는 DB 클라이언트 — 전역 db 또는 트랜잭션 안의 클라이언트.
 * 쓰기 API는 defineRoute가 연 트랜잭션(ctx.db)을 서비스에 넘겨, 변경과 감사 행이 함께 커밋되게 한다.
 */
export type DbClient = Prisma.TransactionClient;

/** client를 주면 그 안에서(이미 트랜잭션 안), 없으면 새 트랜잭션을 열어 work를 실행한다. */
export function inTransaction<T>(client: DbClient | undefined, work: (tx: DbClient) => Promise<T>): Promise<T> {
  return client ? work(client) : db.$transaction(work);
}
