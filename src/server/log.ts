import "server-only";

/**
 * 서버 로그.
 *
 * 절대 규칙 6: 로그에 이름·전화번호 원문을 남기지 않는다.
 * 그래서 값으로 ID·코드·숫자만 받는다. 문자열 필드에는 식별자나 코드만 넣고,
 * 이름·전화번호·생년월일·메모처럼 사람이 입력한 내용은 넣지 않는다.
 * 에러는 메시지 대신 에러 이름과 코드만 기록한다(메시지에 입력값이 섞일 수 있어서).
 */

type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;

type Level = "info" | "warn" | "error";

function write(level: Level, event: string, fields?: LogFields) {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  // 이 파일만 console 사용을 허용한다 (eslint.config.mjs 참고).
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** 에러 객체에서 기록해도 안전한 정보(이름, 코드)만 뽑는다. */
export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return {
      errorName: error.name,
      errorCode: typeof code === "string" || typeof code === "number" ? code : undefined,
    };
  }
  return { errorName: typeof error };
}

export const log = {
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
};
