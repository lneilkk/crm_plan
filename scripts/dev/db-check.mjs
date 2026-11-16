/**
 * DB 접속 확인 (npm run db:check).
 *
 * 앱이 쓰는 것과 같은 DATABASE_URL(.env)로 접속해 서버 버전만 출력한다.
 * 성공하면 종료 코드 0, 실패하면 1. 접속 주소와 비밀번호는 출력하지 않는다.
 */
import { join } from "node:path";
import dotenv from "dotenv";
import pg from "pg";
import { ROOT } from "./compose.mjs";

// 이미 설정된 환경변수(CI 등)가 있으면 .env보다 우선한다.
dotenv.config({ path: join(ROOT, ".env"), quiet: true });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL이 없습니다. npm run db:up 으로 .env를 만들고 DB를 띄우세요.");
  process.exit(1);
}

const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  const { rows } = await client.query("select current_setting('server_version') as version");
  console.log(`DB 연결 성공: PostgreSQL ${rows[0].version}`);
} catch (error) {
  // 에러 메시지에는 접속 주소가 섞일 수 있어 코드만 보여 준다.
  const code = error instanceof Error && "code" in error ? error.code : undefined;
  console.error(
    `DB 연결 실패 (${code ?? "원인 미상"}). DB가 떠 있는지(npm run db:up), .env의 DATABASE_URL이 맞는지 확인하세요.`,
  );
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
