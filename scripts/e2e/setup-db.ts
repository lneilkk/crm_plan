/**
 * E2E용 DB 준비 (npm run test:e2e의 첫 단계).
 *
 * 1. 로컬 DB 서버의 crm_e2e를 지우고 새로 만든다. 개발 DB(crm)는 건드리지 않는다.
 * 2. 마이그레이션 적용(prisma migrate deploy, DATABASE_URL만 crm_e2e로 바꿔서).
 * 3. 시드(병원 기본 설정, 역할별 테스트 계정 — 비밀번호는 .env의 SEED_STAFF_PASSWORD).
 * 4. E2E DB만: 일요일도 평일과 같은 시간에 진료하게 바꾼다 → 요일에 따라 건너뛰는 시나리오가 없다.
 *    (가짜 데이터는 기본 설정 기준이라 일요일에는 가짜 예약이 없다. 시나리오는 자기 예약을 만들어 쓴다.)
 * 5. 가짜 데이터: seed는 고정, 기준 시각은 지금 → '오늘'에 예약이 있다.
 * 0. 개발 서버의 Turbopack 디스크 캐시(.next/dev/cache/turbopack)를 지운다. 코드를 바꾼 직후 남은 캐시와 어긋나면
 *    개발 서버가 브라우저에 전체 새로고침을 계속 보내(1분에 수백 번) 모든 시나리오가 시간 초과로 실패했다(2026-11-12 확인).
 *    빌드 캐시일 뿐이라 지워도 데이터는 없어지지 않는다(첫 컴파일만 느려진다).
 * 6. E2E DB만: 시나리오 전용 체어(E1~E3)를 가짜 데이터 뒤에 더한다. 가짜 예약이 실행 시각 근처의 체어를
 *    모두 채우면 '이미 시작한 예약'을 만들 자리가 없어 시나리오가 실패하므로(실행 시각에 따라 달라짐),
 *    가짜 예약이 없는 체어를 둔다.
 *
 * crm_e2e는 실행이 끝나도 남겨 둔다(검토용). 다음 실행이 다시 만든다.
 * 출력에는 접속 주소·비밀번호·환자 정보를 넣지 않는다(각 단계의 출력도 건수·DB 이름뿐이다).
 */
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import {
  assertE2eDatabaseUrl,
  E2E_DATABASE,
  E2E_FAKE_SEED,
  e2eDatabaseUrl,
  maintenanceDatabaseUrl,
} from "./env";

const ROOT = process.cwd();
const bin = (name: string) => join(ROOT, "node_modules/.bin", name);

async function recreateDatabase(): Promise<void> {
  const client = new pg.Client({ connectionString: maintenanceDatabaseUrl(), connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${E2E_DATABASE}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${E2E_DATABASE}"`);
  } finally {
    await client.end().catch(() => {});
  }
}

/** 일요일(키 "0")의 진료시간을 월요일(키 "1")과 같게 한다. crm_e2e에서만 부른다. */
async function openSundays(url: string): Promise<void> {
  assertE2eDatabaseUrl(url);
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    const { rowCount } = await client.query(
      `UPDATE clinic_setting SET business_hours = jsonb_set(business_hours, '{0}', business_hours->'1') WHERE id = 1 AND business_hours->'1' <> 'null'::jsonb`,
    );
    if (rowCount !== 1) throw new Error("병원 설정(clinic_setting)을 바꾸지 못했습니다.");
  } finally {
    await client.end().catch(() => {});
  }
}

/** 시나리오 전용 체어 3개를 체어 목록 끝에 더한다. crm_e2e에서만 부른다. */
async function addScenarioChairs(url: string): Promise<void> {
  assertE2eDatabaseUrl(url);
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    const extra = [1, 2, 3].map((n) => ({ code: `E${n}`, name: `시험${n}`, kind: "CHAIR" }));
    const { rowCount } = await client.query(`UPDATE clinic_setting SET chairs = chairs || $1::jsonb WHERE id = 1`, [
      JSON.stringify(extra),
    ]);
    if (rowCount !== 1) throw new Error("병원 설정(clinic_setting)을 바꾸지 못했습니다.");
  } finally {
    await client.end().catch(() => {});
  }
}

function run(step: string, command: string, args: string[], env: NodeJS.ProcessEnv): void {
  console.log(`[e2e] ${step}`);
  execFileSync(command, args, { cwd: ROOT, env, stdio: "inherit" });
}

async function main() {
  const url = e2eDatabaseUrl();
  assertE2eDatabaseUrl(url);
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url, FAKE_DATA_ALLOWED: "true" };
  if (!env.SEED_STAFF_PASSWORD) throw new Error("SEED_STAFF_PASSWORD가 .env에 없습니다 (npm run setup:env).");

  console.log("[e2e] 개발 서버 Turbopack 캐시 비우기(.next/dev/cache/turbopack)");
  rmSync(join(ROOT, ".next", "dev", "cache", "turbopack"), { recursive: true, force: true });
  console.log(`[e2e] ${E2E_DATABASE} 다시 만들기`);
  await recreateDatabase();
  run("마이그레이션 적용", bin("prisma"), ["migrate", "deploy"], env);
  run("시드", bin("tsx"), ["--conditions=react-server", "prisma/seed.ts"], env);
  console.log("[e2e] 일요일도 진료일로 설정(E2E DB만)");
  await openSundays(url);
  run("가짜 데이터", bin("tsx"), [
    "--conditions=react-server",
    "scripts/fake-data/run.ts",
    "--seed",
    String(E2E_FAKE_SEED),
    "--now",
    new Date().toISOString(),
  ], env);
  console.log("[e2e] 시나리오 전용 체어 추가(E2E DB만)");
  await addScenarioChairs(url);
  console.log(`[e2e] ${E2E_DATABASE} 준비 완료`);
}

main().catch((error: unknown) => {
  // 에러 메시지에 접속 주소가 섞일 수 있어 이름·코드만 출력한다.
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error && !/postgres(ql)?:\/\//.test(error.message) ? error.message : "";
  console.error(`[e2e] DB 준비 실패: ${error instanceof Error ? error.name : typeof error}${typeof code === "string" ? ` (${code})` : ""} ${message}`);
  process.exitCode = 1;
});
