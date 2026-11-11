/**
 * 운영자용 계정 잠금 해제 — 관리자 계정까지 모두 잠겨 화면(POST /api/staff/[id]/unlock)에서 풀 사람이 없을 때 쓴다.
 *
 * 실행 (서버에서, .env의 DATABASE_URL로 접속):
 *   npm run staff:unlock -- <loginId>
 *
 * - 해제와 감사 행(STAFF_UNLOCK, detail.via = "CLI")을 한 트랜잭션에 쓴다(절대 규칙 4·5).
 * - 출력에는 직원 id와 결과 코드만 넣는다. 비밀번호는 바꾸지 않는다.
 * - "server-only"를 import하는 모듈을 Next.js 밖에서 쓰므로 --conditions=react-server로 실행한다.
 */
import { pathToFileURL } from "node:url";

const USAGE = "사용법: npm run staff:unlock -- <loginId>";

async function main() {
  const loginId = process.argv[2]?.trim();
  if (!loginId || process.argv.length > 3) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const dotenv = await import("dotenv");
  dotenv.config({ quiet: true });
  const { db } = await import("@/server/db");
  const { unlockStaffByLoginId } = await import("@/server/auth/unlock");
  try {
    const result = await unlockStaffByLoginId(db, loginId);
    if (!result.ok) {
      console.error("해당 아이디의 직원이 없습니다.");
      process.exitCode = 1;
      return;
    }
    console.log(
      result.wasLocked
        ? `잠금을 해제했습니다. 직원 id: ${result.staffId}`
        : `잠겨 있지 않았습니다(실패 횟수만 0으로). 직원 id: ${result.staffId}`,
    );
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    // Prisma 에러 메시지에는 쿼리 인자가 섞일 수 있어 이름·코드만 출력한다.
    const code = (error as { code?: unknown } | null)?.code;
    const name = error instanceof Error ? error.name : typeof error;
    console.error(`잠금 해제 실패: ${name}${typeof code === "string" ? ` (${code})` : ""}`);
    process.exitCode = 1;
  });
}
