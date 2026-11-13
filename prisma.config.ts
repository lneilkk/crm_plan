/**
 * Prisma 설정 (Prisma 7).
 *
 * Prisma 7은 .env를 스스로 읽지 않으므로 여기서 dotenv로 읽는다.
 * 이미 설정된 환경변수(CI, 통합 테스트가 임시 DB 주소로 덮어쓴 값)가 .env보다 우선한다.
 *
 * DATABASE_URL이 없어도 `prisma generate`는 동작해야 한다(npm ci 직후 postinstall, CI).
 * 그래서 env()(값이 없으면 예외) 대신 process.env를 그대로 넘긴다.
 * DB에 접속하는 명령(migrate 등)은 값이 없으면 Prisma가 알아서 실패한다.
 */
import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

dotenv.config({ quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // npm run db:seed. "server-only"를 import하는 모듈을 Next.js 밖에서 쓰므로 react-server 조건으로 실행한다.
    seed: "tsx --conditions=react-server prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
