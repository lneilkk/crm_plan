/**
 * 컨테이너 안에서 psql 열기 (npm run db:psql).
 * 뒤에 인자를 붙이면 psql에 그대로 넘긴다. 예: npm run db:psql -- -c "select now()"
 *
 * 계정·DB 이름은 컨테이너의 환경변수에서 읽는다. 컨테이너 안의 로컬 접속이라 비밀번호는 묻지 않는다.
 */
import { compose } from "./compose.mjs";

// 터미널이 아닌 곳(스크립트, 파이프)에서 실행하면 TTY를 요청하지 않는다.
const tty = process.stdin.isTTY ? [] : ["-T"];
const result = compose([
  "exec",
  ...tty,
  "db",
  "sh",
  "-c",
  'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"',
  "psql",
  ...process.argv.slice(2),
]);
process.exit(result.status ?? 1);
