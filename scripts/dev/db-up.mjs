/**
 * 로컬 DB 띄우기 (npm run db:up). 이 명령 하나로 끝난다.
 *
 * 1. .env가 없으면 setup-env로 만든다. 있으면 빠진 변수 이름만 알려 준다.
 * 2. .data/postgres를 현재 사용자 소유로 만든다(Docker가 만들면 root 소유가 된다).
 * 3. db 컨테이너를 띄운다. 실패했는데 컨테이너가 남아 있으면 지우고 한 번 더 시도한다.
 * 4. healthcheck가 통과할 때까지 기다린다.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { compose, ROOT } from "./compose.mjs";
import { formatReport, setupEnv } from "./setup-env.mjs";

const WAIT_MS = 60_000;

/**
 * @param {string[]} args
 * @returns {string} 실패하면 빈 문자열
 */
function docker(args) {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

/**
 * @param {string[]} lines
 * @returns {never}
 */
function fail(...lines) {
  console.error(lines.join("\n"));
  process.exit(1);
}

// .env가 없으면 만들고, 있으면 빠진 변수만 확인한다(있는 값은 바꾸지 않는다).
let envResult;
try {
  envResult = setupEnv(ROOT);
} catch (error) {
  fail(error instanceof Error ? error.message : ".env를 만들지 못했습니다.");
}
if (envResult.created || envResult.missing.length > 0) console.log(formatReport(envResult));
mkdirSync(join(ROOT, ".data", "postgres"), { recursive: true });

/** @returns {string} db 컨테이너 ID. 멈춘 컨테이너도 찾는다(v2의 ps는 -a 없이는 실행 중인 것만 보여 준다). */
function dbContainerId() {
  const result = compose(["ps", "-a", "-q", "db"], { stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 ? result.stdout.trim().split("\n")[0] : "";
}

const up = () => compose(["up", "-d", "db"]).status === 0;

if (!up()) {
  // docker-compose v1은 최신 Docker에서 설정이 바뀐 컨테이너를 다시 만들지 못하고(KeyError: 'ContainerConfig')
  // 멈춘 컨테이너만 남긴다. 컨테이너를 지우고 새로 만들면 된다. 데이터는 .data/postgres에 남는다.
  // 컨테이너가 아예 없으면(.env 값 누락 등) 지워도 달라질 것이 없으므로 다시 시도하지 않는다.
  const retried = dbContainerId() !== "";
  if (retried) {
    console.log("DB 컨테이너를 지우고 새로 만듭니다 (데이터는 .data/postgres에 남습니다).");
    compose(["down"]);
  }
  if (!retried || !up()) {
    fail(
      "DB 컨테이너를 띄우지 못했습니다.",
      envResult.missing.length > 0
        ? "위에 나온 빠진 변수를 .env에 추가한 뒤 다시 실행하세요."
        : "위 오류 메시지를 확인하세요. .env의 값은 .env.example의 설명과 맞아야 합니다.",
    );
  }
}

const containerId = dbContainerId();
if (!containerId) fail("DB 컨테이너를 찾을 수 없습니다.");

const deadline = Date.now() + WAIT_MS;
for (;;) {
  const [status, health] = docker([
    "inspect",
    "--format",
    "{{.State.Status}} {{.State.Health.Status}}",
    containerId,
  ]).split(" ");
  if (health === "healthy") break;
  const logsHint = `로그 확인: docker logs ${containerId.slice(0, 12)}`;
  if (status !== "running") {
    fail(`DB 컨테이너가 멈췄습니다 (상태: ${status || "알 수 없음"}).`, logsHint);
  }
  if (Date.now() > deadline) fail(`DB가 ${WAIT_MS / 1000}초 안에 준비되지 않았습니다.`, logsHint);
  await sleep(500);
}

const address = docker(["port", containerId, "5432/tcp"]).split("\n")[0];
console.log(`DB 준비 완료: ${address} (접속 확인은 npm run db:check)`);
