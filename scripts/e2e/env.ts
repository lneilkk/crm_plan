/**
 * 화면 시나리오 테스트(E2E) 공통 설정 — scripts/e2e/setup-db.ts와 playwright.config.ts가 같이 쓴다.
 *
 * E2E는 개발 DB(crm)를 절대 건드리지 않는다. .env의 DATABASE_URL과 같은 서버의 별도 DB(crm_e2e)를 쓴다.
 * 접속 주소·비밀번호는 출력하지 않는다.
 */
import { join } from "node:path";
import dotenv from "dotenv";

export const E2E_DATABASE = "crm_e2e";
export const E2E_HOST = "127.0.0.1";
export const E2E_PORT = 3105;
export const E2E_BASE_URL = `http://${E2E_HOST}:${E2E_PORT}`;
/** 가짜 데이터 seed — 고정해 두어 실행마다 같은 환자·예약 구성이 나온다(기준 시각만 지금). */
export const E2E_FAKE_SEED = 20261111;

/** 저장소 루트의 .env를 읽는다. 이미 설정된 환경변수가 우선한다. npm 스크립트는 저장소 루트에서 실행된다. */
export function loadDotEnv(): void {
  dotenv.config({ path: join(process.cwd(), ".env"), quiet: true });
}

/** .env의 DATABASE_URL과 같은 서버의 crm_e2e 주소 */
export function e2eDatabaseUrl(): string {
  loadDotEnv();
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL이 없습니다. npm run db:up 으로 .env를 만들고 DB를 띄우세요.");
  const url = new URL(base);
  url.pathname = `/${E2E_DATABASE}`;
  return url.toString();
}

/** 같은 서버의 관리용 DB(postgres) 주소 — DB를 지우고 만들 때 쓴다 */
export function maintenanceDatabaseUrl(): string {
  const url = new URL(e2eDatabaseUrl());
  url.pathname = "/postgres";
  return url.toString();
}

/** 지우고 다시 만드는 대상이 crm_e2e인지 한 번 더 확인한다(개발 DB 보호). */
export function assertE2eDatabaseUrl(url: string): void {
  if (decodeURIComponent(new URL(url).pathname.slice(1)) !== E2E_DATABASE) {
    throw new Error(`E2E는 ${E2E_DATABASE} DB에서만 실행한다.`);
  }
}
