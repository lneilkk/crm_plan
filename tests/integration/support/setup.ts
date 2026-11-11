/**
 * 통합 테스트 파일마다 먼저 실행된다 (vitest.integration.config.mts의 setupFiles).
 * globalSetup이 만든 임시 DB 주소를 DATABASE_URL로 설정해, src/server/db.ts가 그 DB에 붙게 한다.
 */
import { afterAll, inject } from "vitest";
import { assertTestDatabaseUrl } from "./test-db";

const databaseUrl = inject("databaseUrl");
assertTestDatabaseUrl(databaseUrl);
process.env.DATABASE_URL = databaseUrl;

afterAll(async () => {
  // 파일이 끝나면 접속 풀을 닫는다. db.ts가 globalThis에 둔 인스턴스도 비워
  // 다음 파일이 같은 프로세스에서 돌더라도 새로 만들게 한다.
  const { db } = await import("@/server/db");
  await db.$disconnect();
  delete (globalThis as { __crmDb?: unknown }).__crmDb;
});
