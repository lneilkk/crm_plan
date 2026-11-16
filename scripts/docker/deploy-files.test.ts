import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 배포 파일(Dockerfile, docker-compose.prod.yml)의 보안·구성 규칙이 다시 깨지지 않게 확인한다 (T10-1).
const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");

/** "FROM ... AS <name>"부터 다음 FROM 전까지의 단계 본문 */
function stage(dockerfile: string, name: string): string {
  const parts = dockerfile.split(/^FROM /m);
  const found = parts.find((part) => new RegExp(`\\bAS ${name}\\s*$`, "m").test(part.split("\n")[0]));
  if (!found) throw new Error(`단계 없음: ${name}`);
  return found;
}

/** docker-compose.prod.yml에서 서비스 하나의 블록(들여쓰기 2칸 키부터 다음 서비스 전까지) */
function service(compose: string, name: string): string {
  const match = compose.match(new RegExp(`^  ${name}:\\n((?:    .*\\n|\\s*\\n)+)`, "m"));
  if (!match) throw new Error(`서비스 없음: ${name}`);
  return match[1];
}

describe("Dockerfile", () => {
  const dockerfile = read("Dockerfile");
  const runtime = stage(dockerfile, "runtime");

  it("runtime 단계는 root가 아닌 node 사용자로 실행한다", () => {
    expect(runtime).toMatch(/^USER node$/m);
  });

  it("runtime 단계는 standalone 결과물에 빠지는 public/과 .next/static을 복사한다", () => {
    expect(runtime).toContain("COPY --from=build /app/.next/static ./.next/static");
    expect(runtime).toContain("COPY --from=build /app/public ./public");
    // public/이 아직 없어도 빌드가 실패하지 않도록 build 단계에서 폴더를 만든다.
    expect(stage(dockerfile, "build")).toMatch(/mkdir -p public/);
  });

  it(".env를 이미지에 복사하지 않는다", () => {
    expect(dockerfile).not.toMatch(/COPY[^\n]*\.env/);
    expect(read(".dockerignore")).toMatch(/^\.env\*$/m);
  });
});

describe("docker-compose.prod.yml", () => {
  const compose = read("docker-compose.prod.yml");
  const app = service(compose, "app");

  it("app에는 시드 전용 값(SEED_STAFF_PASSWORD, FAKE_DATA_ALLOWED)을 빈 값으로 덮어써 넘기지 않는다", () => {
    expect(app).toMatch(/^      SEED_STAFF_PASSWORD: ""$/m);
    expect(app).toMatch(/^      FAKE_DATA_ALLOWED: ""$/m);
  });

  it("app은 읽기 전용·권한 제거·127.0.0.1 포트로 실행한다", () => {
    expect(app).toMatch(/read_only: true/);
    expect(app).toMatch(/cap_drop:\n\s+- ALL/);
    expect(app).toMatch(/no-new-privileges:true/);
    expect(app).toMatch(/"127\.0\.0\.1:\$\{APP_PORT:-3100\}:3000"/);
  });
});
