/**
 * 통합 테스트 전역 준비 (vitest.integration.config.mts의 globalSetup).
 *
 * 1. 로컬 DB 서버에 새 임시 DB(crm_test_<pid>_<시각>)를 만든다.
 * 2. 그 DB에 마이그레이션을 적용한다(prisma migrate deploy, DATABASE_URL만 바꿔서).
 * 3. 주소를 테스트에 넘긴다(provide → support/setup.ts에서 inject).
 * 4. 끝나면 DB를 지운다. 비정상 종료로 남은 DB는 npm run db:test:clean으로 지운다.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import {
  ROOT,
  assertTestDatabaseUrl,
  baseDatabaseUrl,
  newTestDatabaseName,
  quoteIdent,
  withAdminClient,
  withDatabase,
} from "./test-db";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const baseUrl = baseDatabaseUrl();
  const database = newTestDatabaseName();
  const testUrl = withDatabase(baseUrl, database);
  assertTestDatabaseUrl(testUrl);

  await withAdminClient(baseUrl, (client) => client.query(`CREATE DATABASE ${quoteIdent(database)}`));

  const dropDatabase = () =>
    withAdminClient(baseUrl, (client) => client.query(`DROP DATABASE IF EXISTS ${quoteIdent(database)} WITH (FORCE)`));

  try {
    execFileSync(join(ROOT, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: testUrl },
      stdio: "pipe",
    });
  } catch (error) {
    await dropDatabase();
    // Prisma 출력에는 접속 비밀번호가 들어 있지 않다(호스트·DB 이름만). 원인을 보여 주기 위해 그대로 넘긴다.
    const { stdout = "", stderr = "" } = error as { stdout?: Buffer | string; stderr?: Buffer | string };
    const output = `${stdout}${stderr}`;
    throw new Error(`임시 테스트 DB에 마이그레이션을 적용하지 못했습니다.\n${output}`);
  }

  project.provide("databaseUrl", testUrl);

  return async () => {
    await dropDatabase();
  };
}
