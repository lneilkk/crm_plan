/**
 * 로컬 DB 내리기 (npm run db:down).
 * 컨테이너만 멈추고 지운다. 데이터(.data/postgres)는 남으므로 db:up으로 다시 띄우면 그대로 있다.
 * 데이터까지 지우려면 내린 뒤 .data/postgres 폴더를 지운다.
 */
import { compose } from "./compose.mjs";

process.exit(compose(["down"]).status ?? 1);
