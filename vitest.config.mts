import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// 단위 테스트 설정. DB가 필요한 통합 테스트는 vitest.integration.config.ts에서 따로 돌린다.
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
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
  },
});
