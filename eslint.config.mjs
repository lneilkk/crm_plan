import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// 서버 로컬 시간대에 따라 결과가 달라지는 Date 메서드. 한국 시간 계산은 src/lib/time/kst.ts만 쓴다.
const LOCAL_TIME_METHODS =
  "getDate|getDay|getHours|getMinutes|getMonth|getFullYear|getTimezoneOffset|setDate|setHours|setMinutes|setMonth|setFullYear|toLocaleDateString|toLocaleTimeString";

const projectRules = [
  {
    selector: "ExpressionStatement[directive=/^use (server|cache)/]",
    message:
      "'use server'(Server Action)와 'use cache'는 쓰지 않는다. 데이터 조회·변경은 src/app/api/**/route.ts로만 만들고, 환자 데이터는 캐시하지 않는다. (CLAUDE.md 구현 규칙)",
  },
  {
    selector: `CallExpression[callee.property.name=/^(${LOCAL_TIME_METHODS})$/]`,
    message:
      "서버 로컬 시간대에 의존하는 Date 메서드다. 날짜·요일·시각 계산은 src/lib/time/kst.ts의 함수를 쓴다. (CLAUDE.md 구현 규칙)",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.{ts,mts,mjs}", "tests/**/*.{ts,tsx}", "prisma/**/*.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...projectRules],
    },
  },
  {
    // 절대 규칙 6: 로그에 이름·전화번호 원문을 남기지 않는다 → 앱 코드는 src/server/log.ts만 쓴다.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/server/log.ts", "src/**/*.test.{ts,tsx}"],
    rules: {
      "no-console": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 자동 생성물과 로컬 데이터
    "src/generated/**",
    ".data/**",
    ".tmp/**",
    ".cache/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
