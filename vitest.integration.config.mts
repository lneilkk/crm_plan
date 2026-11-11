import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// 통합 테스트 설정 (npm run test:integration). 실제 PostgreSQL이 필요하다(npm run db:up).
// globalSetup이 실행마다 새 임시 DB(crm_test_*)를 만들고 마이그레이션을 적용한 뒤, 끝나면 지운다.
// 테스트 파일들이 같은 DB를 쓰므로 파일을 하나씩 차례로 실행한다.
export default defineConfig({
  resolve: {
    alias: {
      "@": fromRoot("./src"),
      // server-only는 Next.js 서버 번들 밖에서 import하면 예외를 던지므로 테스트에서는 빈 모듈로 바꾼다.
      "server-only": fromRoot("./tests/support/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["./tests/integration/support/global-setup.ts"],
    setupFiles: ["./tests/integration/support/setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
