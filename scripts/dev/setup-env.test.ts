import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatReport, parseEnv, setupEnv } from "./setup-env.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const EXAMPLE = readFileSync(join(ROOT, ".env.example"), "utf8");

/** 스크립트가 채워 넣는 비밀값. 예시 파일에는 비어 있어야 하고 출력에 나오면 안 된다. */
const SECRET_KEYS = [
  "POSTGRES_PASSWORD",
  "DATABASE_URL",
  "PII_ENC_KEY",
  "PII_HMAC_KEY",
  "SEED_STAFF_PASSWORD",
] as const;

let dir: string;

beforeEach(() => {
  // 절대 규칙 7: 임시 파일도 저장소 안(.tmp/, git 제외)에만 만든다.
  mkdirSync(join(ROOT, ".tmp"), { recursive: true });
  dir = mkdtempSync(join(ROOT, ".tmp", "setup-env-test-"));
  writeFileSync(join(dir, ".env.example"), EXAMPLE);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function readEnv(): Record<string, string> {
  return parseEnv(readFileSync(join(dir, ".env"), "utf8"));
}

describe(".env.example", () => {
  it("다른 Task가 쓰는 변수 이름을 모두 담고 있다", () => {
    expect(Object.keys(parseEnv(EXAMPLE))).toEqual([
      "COMPOSE_PROJECT_NAME",
      "POSTGRES_USER",
      "POSTGRES_DB",
      "POSTGRES_PORT",
      "POSTGRES_PASSWORD",
      "DATABASE_URL",
      "PII_ENC_KEY",
      "PII_HMAC_KEY",
      "SEED_STAFF_PASSWORD",
      "FAKE_DATA_ALLOWED",
      "HOST_UID",
      "HOST_GID",
    ]);
  });

  it("비밀값은 비어 있다 (절대 규칙 2)", () => {
    const example = parseEnv(EXAMPLE);
    for (const key of SECRET_KEYS) {
      expect(example[key], key).toBe("");
    }
  });

  it("비밀이 아닌 기본값은 정해진 값이다", () => {
    expect(parseEnv(EXAMPLE)).toMatchObject({
      COMPOSE_PROJECT_NAME: "crm_plan",
      POSTGRES_USER: "crm",
      POSTGRES_DB: "crm",
      POSTGRES_PORT: "54329",
      FAKE_DATA_ALLOWED: "true",
    });
  });
});

describe("setupEnv — .env가 없을 때", () => {
  it(".env를 만들고 비밀값을 모두 채운다", () => {
    const result = setupEnv(dir);
    expect(result).toEqual({ created: true, missing: [] });

    const env = readEnv();
    expect(Object.keys(env)).toEqual(Object.keys(parseEnv(EXAMPLE)));
    for (const [key, value] of Object.entries(env)) {
      expect(value, key).not.toBe("");
    }
  });

  it("파일 권한은 600이다", () => {
    setupEnv(dir);
    expect(statSync(join(dir, ".env")).mode & 0o777).toBe(0o600);
  });

  it("DB 비밀번호는 URL에 그대로 넣을 수 있는 문자만 쓴다", () => {
    setupEnv(dir);
    expect(readEnv().POSTGRES_PASSWORD).toMatch(/^[A-Za-z0-9_-]{24,}$/);
  });

  it("DATABASE_URL은 나머지 값으로 조립하고 호스트는 127.0.0.1이다", () => {
    setupEnv(dir);
    const env = readEnv();
    const url = new URL(env.DATABASE_URL);
    expect(url.protocol).toBe("postgresql:");
    expect(url.hostname).toBe("127.0.0.1");
    expect(url.port).toBe("54329");
    expect(url.username).toBe("crm");
    expect(url.password).toBe(env.POSTGRES_PASSWORD);
    expect(url.pathname).toBe("/crm");
  });

  it("암호화 키와 HMAC 키는 서로 다른 32바이트 값의 base64다", () => {
    setupEnv(dir);
    const env = readEnv();
    expect(Buffer.from(env.PII_ENC_KEY, "base64")).toHaveLength(32);
    expect(Buffer.from(env.PII_HMAC_KEY, "base64")).toHaveLength(32);
    expect(env.PII_ENC_KEY).not.toBe(env.PII_HMAC_KEY);
  });

  it("테스트 계정 비밀번호는 16자 이상이고 헷갈리는 글자(0·o·1·l·i)가 없다", () => {
    setupEnv(dir);
    const password = readEnv().SEED_STAFF_PASSWORD;
    expect(password.length).toBeGreaterThanOrEqual(16);
    expect(password).toMatch(/^[a-hjkmnp-z2-9-]+$/);
  });

  it("HOST_UID·HOST_GID는 현재 사용자다", () => {
    setupEnv(dir);
    const env = readEnv();
    expect(env.HOST_UID).toBe(String(process.getuid?.()));
    expect(env.HOST_GID).toBe(String(process.getgid?.()));
  });

  it("실행할 때마다 다른 비밀값을 만든다", () => {
    setupEnv(dir);
    const first = readEnv();
    rmSync(join(dir, ".env"));
    setupEnv(dir);
    const second = readEnv();
    for (const key of SECRET_KEYS) {
      expect(second[key], key).not.toBe(first[key]);
    }
  });

  it("주석과 변수 순서는 예시 파일 그대로다", () => {
    setupEnv(dir);
    const strip = (text: string) => text.replace(/^([A-Z0-9_]+)=.*$/gm, "$1=");
    expect(strip(readFileSync(join(dir, ".env"), "utf8"))).toBe(strip(EXAMPLE));
  });
});

describe("setupEnv — 예시 파일이 예상과 다를 때", () => {
  it("줄 끝이 CRLF여도(Windows 체크아웃) 비밀값을 모두 채운다", () => {
    writeFileSync(join(dir, ".env.example"), EXAMPLE.replaceAll("\n", "\r\n"));

    expect(setupEnv(dir)).toEqual({ created: true, missing: [] });

    const env = readEnv();
    expect(Object.keys(env)).toEqual(Object.keys(parseEnv(EXAMPLE)));
    for (const [key, value] of Object.entries(env)) {
      expect(value, key).not.toBe("");
      expect(value, key).not.toContain("\r");
    }
    expect(env.DATABASE_URL).toBe(
      `postgresql://crm:${env.POSTGRES_PASSWORD}@127.0.0.1:54329/crm`,
    );
  });

  it("채워야 할 변수가 예시 파일에 없으면 .env를 만들지 않고 실패한다", () => {
    writeFileSync(join(dir, ".env.example"), EXAMPLE.replace(/^PII_ENC_KEY=.*$/m, ""));

    expect(() => setupEnv(dir)).toThrow(/PII_ENC_KEY/);
    expect(existsSync(join(dir, ".env"))).toBe(false);
  });
});

describe("setupEnv — .env가 이미 있을 때", () => {
  it("파일을 한 바이트도 바꾸지 않는다", () => {
    setupEnv(dir);
    const before = readFileSync(join(dir, ".env"));
    const result = setupEnv(dir);
    expect(result.created).toBe(false);
    expect(readFileSync(join(dir, ".env")).equals(before)).toBe(true);
  });

  it("값이 비어 있거나 직접 고친 .env도 건드리지 않는다", () => {
    const custom = "POSTGRES_PASSWORD=\nPOSTGRES_USER=other\n";
    writeFileSync(join(dir, ".env"), custom, { mode: 0o640 });
    setupEnv(dir);
    expect(readFileSync(join(dir, ".env"), "utf8")).toBe(custom);
    expect(statSync(join(dir, ".env")).mode & 0o777).toBe(0o640);
  });

  it("예시 파일에만 있는 변수를 이름으로 알려 준다", () => {
    writeFileSync(join(dir, ".env"), "POSTGRES_USER=crm\nPOSTGRES_DB=crm\n");
    const result = setupEnv(dir);
    expect(result.created).toBe(false);
    expect(result.missing).toEqual([
      "COMPOSE_PROJECT_NAME",
      "POSTGRES_PORT",
      "POSTGRES_PASSWORD",
      "DATABASE_URL",
      "PII_ENC_KEY",
      "PII_HMAC_KEY",
      "SEED_STAFF_PASSWORD",
      "FAKE_DATA_ALLOWED",
      "HOST_UID",
      "HOST_GID",
    ]);
  });
});

describe("formatReport", () => {
  it("새로 만들었을 때도 비밀값을 출력하지 않는다", () => {
    const report = formatReport(setupEnv(dir));
    const env = readEnv();
    for (const key of SECRET_KEYS) {
      expect(report, key).not.toContain(env[key]);
    }
  });

  it("빠진 변수는 이름만 출력한다", () => {
    const secret = "do-not-print-this-value";
    writeFileSync(join(dir, ".env"), `POSTGRES_PASSWORD=${secret}\n`);
    const report = formatReport(setupEnv(dir));
    expect(report).toContain("PII_ENC_KEY");
    expect(report).not.toContain("POSTGRES_PASSWORD");
    expect(report).not.toContain(secret);
  });
});
