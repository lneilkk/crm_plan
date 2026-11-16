/**
 * 통합 테스트용 임시 DB 공통 함수.
 *
 * 통합 테스트는 실행할 때마다 새 DB(crm_test_<pid>_<시각>)를 만들어 쓰고 끝나면 지운다.
 * 같은 서버에서 여러 사람·에이전트가 동시에 테스트를 돌려도 서로의 데이터를 건드리지 않고,
 * 개발 DB(crm)는 절대 건드리지 않는다.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

export const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
export const TEST_DB_PREFIX = "crm_test_";
const TEST_DB_NAME_RE = /^crm_test_(\d+)_(\d+)$/;

/** .env(또는 이미 설정된 환경변수)의 DATABASE_URL. 이 주소의 서버에 임시 DB를 만든다. */
export function baseDatabaseUrl(): string {
  dotenv.config({ path: join(ROOT, ".env"), quiet: true });
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL이 없습니다. npm run db:up 으로 .env를 만들고 DB를 띄우세요.");
  }
  return url;
}

/** 같은 서버의 다른 DB를 가리키는 주소 */
export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

export function databaseNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

export function newTestDatabaseName(): string {
  return `${TEST_DB_PREFIX}${process.pid}_${Date.now()}`;
}

/** 테스트 DB 이름에서 만든 프로세스 id를 꺼낸다. 형식이 다르면 null */
export function ownerPidOf(database: string): number | null {
  const match = TEST_DB_NAME_RE.exec(database);
  return match ? Number(match[1]) : null;
}

/** 테스트 코드가 지우거나 비우는 DB가 임시 테스트 DB인지 확인한다(개발 DB 보호). */
export function assertTestDatabaseUrl(url: string | undefined): asserts url is string {
  if (!url || ownerPidOf(databaseNameOf(url)) === null) {
    throw new Error(`통합 테스트는 ${TEST_DB_PREFIX}* 임시 DB에서만 실행한다. 설정을 확인하세요.`);
  }
}

/** 관리용 접속(maintenance DB "postgres")으로 작업 하나를 실행한다. */
export async function withAdminClient<T>(baseUrl: string, work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: withDatabase(baseUrl, "postgres"), connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end().catch(() => {});
  }
}

/** 식별자 인용. DB 이름은 위 정규식을 통과한 값만 쓰지만 한 번 더 막는다. */
export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}
