/**
 * Docker Compose 실행 도우미.
 *
 * 개발 서버에는 v1(`docker-compose`)만 있고 CI·다른 PC에는 v2(`docker compose`)가 있어서
 * 있는 쪽을 찾아 쓴다. 항상 저장소 루트에서 실행해 docker-compose.yml과 .env를 읽게 한다.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** 저장소 루트 (docker-compose.yml, .env가 있는 곳) */
export const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * @param {string} command
 * @param {string[]} args
 */
function works(command, args) {
  return spawnSync(command, args, { stdio: "ignore" }).status === 0;
}

/** @returns {string[]} 실행 파일과 앞에 붙일 인자 */
function composeCommand() {
  if (works("docker", ["compose", "version"])) return ["docker", "compose"];
  if (works("docker-compose", ["version"])) return ["docker-compose"];
  console.error("Docker Compose를 찾을 수 없습니다. Docker를 설치했는지 확인하세요.");
  process.exit(1);
}

/**
 * Compose 명령을 실행한다. 기본은 출력을 그대로 터미널에 보여 준다.
 * @param {string[]} args 예: ["up", "-d", "db"]
 * @param {import("node:child_process").SpawnSyncOptionsWithStringEncoding} [options]
 */
export function compose(args, options) {
  const [command, ...prefix] = composeCommand();
  return spawnSync(command, [...prefix, ...args], {
    cwd: ROOT,
    stdio: "inherit",
    encoding: "utf8",
    ...options,
  });
}
