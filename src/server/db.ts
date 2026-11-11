import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

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
