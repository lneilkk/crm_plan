/**
 * 남은 통합 테스트 DB 정리 (npm run db:test:clean).
 *
 * 테스트가 강제 종료되면 globalSetup의 정리 단계가 돌지 않아 crm_test_* DB가 남는다.
 * 다른 사람·에이전트가 지금 돌리고 있는 테스트의 DB는 지우면 안 되므로,
 * 이름에 든 프로세스 id가 이 PC에서 아직 살아 있으면 남겨 둔다.
 * 개발 DB(crm)는 이름 형식이 달라 대상이 되지 않는다.
 */
import { ownerPidOf, quoteIdent, TEST_DB_PREFIX, baseDatabaseUrl, withAdminClient } from "./test-db";

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: 프로세스는 있지만 다른 사용자 것이다 → 살아 있음으로 본다.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function main() {
  const baseUrl = baseDatabaseUrl();
  await withAdminClient(baseUrl, async (client) => {
    const { rows } = await client.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE starts_with(datname, $1) ORDER BY datname",
      [TEST_DB_PREFIX],
    );
    let dropped = 0;
    let kept = 0;
    for (const { datname } of rows) {
      const pid = ownerPidOf(datname);
      if (pid === null || isProcessAlive(pid)) {
        kept += 1;
        continue;
      }
      await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(datname)} WITH (FORCE)`);
      dropped += 1;
    }
    console.log(`통합 테스트 DB 정리: ${dropped}개 삭제, ${kept}개 유지(실행 중이거나 이름 형식이 다름)`);
  });
}

main().catch((error: unknown) => {
  const code = error instanceof Error && "code" in error ? String(error.code) : "원인 미상";
  console.error(`통합 테스트 DB 정리 실패 (${code}). DB가 떠 있는지(npm run db:up) 확인하세요.`);
  process.exitCode = 1;
});
