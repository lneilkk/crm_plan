/**
 * FAKE_DATA_ALLOWED 확인 — npm run db:fresh는 DB를 지우기 전에 이 확인을 먼저 통과해야 한다.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isFakeDataAllowed } from "./allowed";

const root = fileURLToPath(new URL("../../", import.meta.url));
const script = fileURLToPath(new URL("./allowed.ts", import.meta.url));
const tsx = fileURLToPath(new URL("../../node_modules/.bin/tsx", import.meta.url));

/** 명령줄로 실행. 명시한 환경 변수는 .env보다 우선한다(dotenv는 이미 있는 값을 덮지 않는다). */
function runCli(flag: string) {
  return spawnSync(tsx, [script], {
    cwd: root,
    env: { ...process.env, FAKE_DATA_ALLOWED: flag },
    encoding: "utf8",
  });
}

describe("isFakeDataAllowed", () => {
  it("정확히 \"true\"일 때만 허용한다", () => {
    expect(isFakeDataAllowed({ FAKE_DATA_ALLOWED: "true" })).toBe(true);
    for (const value of [undefined, "", "1", "TRUE", "yes", " true"]) {
      expect(isFakeDataAllowed({ FAKE_DATA_ALLOWED: value })).toBe(false);
    }
  });
});

describe("allowed.ts 명령줄", () => {
  it("허용되지 않으면 종료 코드 1과 안내 메시지로 멈춘다", () => {
    const result = runCli("false");
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/FAKE_DATA_ALLOWED=true/);
  });

  it("허용되면 종료 코드 0", () => {
    expect(runCli("true").status).toBe(0);
  });
});

describe("npm run db:fresh", () => {
  it("DB를 지우는 db:reset보다 먼저 FAKE_DATA_ALLOWED를 확인한다", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      scripts: Record<string, string>;
    };
    const fresh = pkg.scripts["db:fresh"];
    expect(fresh.startsWith("tsx scripts/fake-data/allowed.ts && ")).toBe(true);
    expect(fresh.indexOf("allowed.ts")).toBeLessThan(fresh.indexOf("db:reset"));
  });
});
