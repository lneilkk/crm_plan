/**
 * .env 생성 스크립트 (npm run setup:env).
 *
 * - .env가 없으면 .env.example을 복사하고 비밀값을 무작위로 채운다. 파일 권한은 600.
 * - .env가 이미 있으면 절대 덮어쓰지 않고 값도 바꾸지 않는다.
 *   .env.example에는 있는데 .env에 없는 변수를 이름으로만 알려 준다.
 * - 비밀값은 어떤 경우에도 화면에 출력하지 않는다(절대 규칙 2).
 */
import { randomBytes, randomInt } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ENV_LINE_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/** 테스트 계정 비밀번호에 쓰는 글자. 손으로 입력하기 쉽게 헷갈리는 0·o·1·l·i는 뺐다. */
const TYPEABLE = "abcdefghjkmnpqrstuvwxyz23456789";

/**
 * `KEY=value` 줄만 읽는다. 따옴표나 줄 끝 주석은 쓰지 않는 것이 이 프로젝트의 규칙이다.
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnv(text) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = ENV_LINE_RE.exec(line);
    if (match) env[match[1]] = match[2].trim();
  }
  return env;
}

/** 5글자씩 4묶음(예: abcde-fghjk-mnpqr-stuvw). 31^20 ≈ 99비트. */
function typeablePassword() {
  const group = () =>
    Array.from({ length: 5 }, () => TYPEABLE[randomInt(TYPEABLE.length)]).join("");
  return [group(), group(), group(), group()].join("-");
}

/**
 * 예시 파일에서 비어 있는 값을 채울 내용을 만든다.
 * @param {Record<string, string>} example .env.example의 값
 * @returns {Record<string, string>}
 */
function generateValues(example) {
  // base64url은 A-Z a-z 0-9 - _ 만 쓰므로 접속 주소에 그대로 넣을 수 있다.
  const dbPassword = randomBytes(24).toString("base64url");
  const user = encodeURIComponent(example.POSTGRES_USER);
  const db = encodeURIComponent(example.POSTGRES_DB);
  return {
    POSTGRES_PASSWORD: dbPassword,
    DATABASE_URL: `postgresql://${user}:${dbPassword}@127.0.0.1:${example.POSTGRES_PORT}/${db}`,
    PII_ENC_KEY: randomBytes(32).toString("base64"),
    PII_HMAC_KEY: randomBytes(32).toString("base64"),
    SEED_STAFF_PASSWORD: typeablePassword(),
    // Windows에는 uid가 없다. Docker Desktop은 이 값과 무관하게 동작하므로 흔한 기본값을 넣는다.
    HOST_UID: String(process.getuid?.() ?? 1000),
    HOST_GID: String(process.getgid?.() ?? 1000),
  };
}

/**
 * @param {string} rootDir .env.example이 있는 폴더
 * @returns {{ created: boolean, missing: string[] }} 변수 이름만 담는다. 값은 돌려주지 않는다.
 */
export function setupEnv(rootDir) {
  const envPath = join(rootDir, ".env");
  const exampleText = readFileSync(join(rootDir, ".env.example"), "utf8");
  const example = parseEnv(exampleText);

  if (existsSync(envPath)) {
    const current = parseEnv(readFileSync(envPath, "utf8"));
    return { created: false, missing: Object.keys(example).filter((key) => !(key in current)) };
  }

  const values = generateValues(example);
  const filled = new Set();
  // 줄 끝이 CRLF인 체크아웃(Windows)에서도 같은 결과가 나오게 \r은 떼고 맞춰 본 뒤 그대로 돌려 붙인다.
  const text = exampleText
    .split("\n")
    .map((rawLine) => {
      const eol = rawLine.endsWith("\r") ? "\r" : "";
      const key = ENV_LINE_RE.exec(eol ? rawLine.slice(0, -1) : rawLine)?.[1];
      if (!key || !(key in values)) return rawLine;
      filled.add(key);
      return `${key}=${values[key]}${eol}`;
    })
    .join("\n");
  // 비밀값이 빈 .env가 한번 생기면 다시는 채워지지 않으므로, 하나라도 못 채웠으면 만들지 않는다.
  const unfilled = Object.keys(values).filter((key) => !filled.has(key));
  if (unfilled.length > 0) {
    throw new Error(`.env.example에서 다음 변수를 찾지 못해 .env를 만들지 않았습니다: ${unfilled.join(", ")}`);
  }
  // "wx": 그 사이에 파일이 생겼다면 덮어쓰지 않고 실패한다.
  writeFileSync(envPath, text, { mode: 0o600, flag: "wx" });
  return { created: true, missing: [] };
}

/**
 * @param {{ created: boolean, missing: string[] }} result
 * @returns {string}
 */
export function formatReport(result) {
  if (result.created) {
    return ".env를 만들었습니다 (권한 600). 비밀값은 화면에 출력하지 않습니다.";
  }
  if (result.missing.length === 0) {
    return ".env가 이미 있어 그대로 둡니다. 빠진 변수는 없습니다.";
  }
  return [
    ".env가 이미 있어 그대로 둡니다. .env.example에는 있지만 .env에 없는 변수:",
    ...result.missing.map((key) => `  - ${key}`),
    ".env.example의 설명을 보고 .env에 직접 추가하세요.",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  try {
    console.log(formatReport(setupEnv(root)));
  } catch (error) {
    // 스크립트가 던지는 메시지에는 변수 이름과 파일 경로만 있다.
    console.error(error instanceof Error ? error.message : "알 수 없는 오류");
    process.exit(1);
  }
}
