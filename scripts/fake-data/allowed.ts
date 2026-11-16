/**
 * 가짜 데이터 허용 확인 — FAKE_DATA_ALLOWED=true인 개발·프로토타입 DB에서만 가짜 데이터를 다룬다.
 *
 * run.ts(insertFakeData)가 넣기 전에 쓰고, npm run db:fresh는 DB를 지우기(db:reset) 전에 이 파일을
 * 명령줄로 실행한다: tsx scripts/fake-data/allowed.ts → 허용되지 않으면 종료 코드 1로 멈춘다.
 * 실제 운영 DB에는 이 변수를 두지 않으므로 운영 DB는 지워지지도, 가짜 데이터가 들어가지도 않는다.
 */
import { pathToFileURL } from "node:url";
import { config as loadDotenv } from "dotenv";

export const FAKE_DATA_NOT_ALLOWED_MESSAGE =
  "FAKE_DATA_ALLOWED=true일 때만 가짜 데이터를 다룹니다. 개발·프로토타입 DB인지 확인하고 .env에 설정하세요.";

/** 정확히 "true"일 때만 허용한다("1"·"TRUE"도 거부). */
export function isFakeDataAllowed(env: { [name: string]: string | undefined }): boolean {
  return env.FAKE_DATA_ALLOWED === "true";
}

// 명령줄에서 직접 실행했을 때만: .env를 읽고(이미 있는 환경 변수가 우선) 허용 여부를 종료 코드로 알린다.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadDotenv({ quiet: true });
  if (!isFakeDataAllowed(process.env)) {
    console.error(`멈춤: ${FAKE_DATA_NOT_ALLOWED_MESSAGE}`);
    process.exit(1);
  }
}
