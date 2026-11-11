import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE_URL, E2E_HOST, E2E_PORT, e2eDatabaseUrl, loadDotEnv } from "./scripts/e2e/env";

/**
 * 화면 시나리오 테스트 (npm run test:e2e).
 *
 * - DB는 scripts/e2e/setup-db.ts가 먼저 준비한 crm_e2e만 쓴다(개발 DB crm은 건드리지 않는다).
 * - next dev를 127.0.0.1:3105에 새로 띄운다(이미 떠 있는 서버는 쓰지 않는다).
 * - 브라우저는 저장소의 .cache/ms-playwright에 설치된 Chromium을 쓴다(내려받지 않는다).
 * - 시나리오들이 같은 DB·같은 '오늘'을 보므로(요약 건수 비교) 하나씩 차례로 실행한다.
 * - 비밀번호는 .env의 SEED_STAFF_PASSWORD를 process.env로만 읽는다. 추적·스크린샷은 git 제외 폴더에만 남는다.
 */
loadDotEnv();
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(process.cwd(), ".cache/ms-playwright");

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // skip-guard: 건너뛴 시나리오가 있으면 실패(E2E_ALLOW_SKIP=1이면 허용) — 건너뛴 채로 통과하지 않게
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ["./tests/e2e/skip-guard-reporter.ts"],
  ],
  use: {
    baseURL: E2E_BASE_URL,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    viewport: { width: 1600, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 1000 } } }],
  webServer: {
    command: `node_modules/.bin/next dev --hostname ${E2E_HOST} --port ${E2E_PORT}`,
    url: `${E2E_BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
    env: { ...(process.env as Record<string, string>), DATABASE_URL: e2eDatabaseUrl() },
  },
});
