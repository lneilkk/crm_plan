/**
 * 절대 규칙 5 — visit_status_log와 감사 로그(audit_log)는 추가만 한다. 수정·삭제 코드를 만들지 않는다.
 *
 * src/·scripts/·prisma/ 아래 소스(자동 생성된 src/generated 제외)를 읽어, 두 테이블을 고치거나 지우는 코드가 있으면 실패한다.
 * - Prisma 호출: auditLog / visitStatusLog 의 update·updateMany·upsert·delete·deleteMany
 *   (… .auditLog\n  .update(…)처럼 줄을 나눠 쓴 것도 잡는다)
 * - 원시 SQL: UPDATE audit_log, DELETE FROM visit_status_log 등 (따옴표·스키마 접두어 포함)
 * 테스트 정리용 TRUNCATE(tests/integration/helpers)는 tests/ 아래라 검사 대상이 아니다.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCAN_DIRS = ["src", "scripts", "prisma"];
const SOURCE_RE = /\.(ts|tsx|js|mjs|cjs|mts|cts|sql)$/;
const SELF = relative(ROOT, fileURLToPath(import.meta.url)).split(sep).join("/");

const PRISMA_WRITE = /\b(auditLog|visitStatusLog)\s*\??\.\s*(update|updateMany|updateManyAndReturn|upsert|delete|deleteMany)\b/;
const SQL_WRITE = /\b(UPDATE|DELETE\s+FROM)\s+(?:ONLY\s+)?(?:"?public"?\s*\.\s*)?"?(audit_log|visit_status_log)\b/i;

export function findAppendOnlyViolations(source: string): string[] {
  const found: string[] = [];
  for (const re of [PRISMA_WRITE, SQL_WRITE]) {
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    for (const match of source.matchAll(global)) found.push(match[0].replace(/\s+/g, " "));
  }
  return found;
}

function sourceFiles(): string[] {
  const files: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of readdirSync(join(ROOT, dir), { recursive: true }) as string[]) {
      const path = `${dir}/${file.split(sep).join("/")}`;
      if (!SOURCE_RE.test(path) || path.startsWith("src/generated/") || path === SELF) continue;
      files.push(path);
    }
  }
  return files.sort();
}

describe("추가 전용 테이블(visit_status_log, audit_log)을 고치거나 지우는 코드가 없다", () => {
  const files = sourceFiles();

  it("검사할 파일을 찾았다", () => {
    expect(files).toEqual(expect.arrayContaining(["src/server/api/audit.ts", "src/server/appointments/status.ts"]));
  });

  it("src·scripts·prisma 어디에도 없다", () => {
    const violations = files.flatMap((file) =>
      findAppendOnlyViolations(readFileSync(join(ROOT, file), "utf8")).map((hit) => `${file}: ${hit}`),
    );
    expect(violations).toEqual([]);
  });
});

describe("검사기 자체", () => {
  it.each([
    "await db.auditLog.update({ where: { id } })",
    "tx.visitStatusLog.deleteMany({})",
    "db.auditLog\n  .upsert({})",
    "client?.visitStatusLog?.delete({})",
    'await tx.$executeRaw`UPDATE "audit_log" SET detail = null`',
    "DELETE FROM visit_status_log WHERE true",
    'delete from public."audit_log"',
  ])("잡는다: %s", (source) => {
    expect(findAppendOnlyViolations(source)).not.toEqual([]);
  });

  it.each([
    "await tx.auditLog.create({ data })",
    "db.visitStatusLog.findMany({})",
    "db.appointment.update({ where: { id } })",
    'TRUNCATE TABLE "public"."audit_log"',
    "UPDATE appointment SET status = 'ARRIVED'",
    "INSERT INTO audit_log (id) VALUES (1)",
  ])("추가·조회는 그대로 둔다: %s", (source) => {
    expect(findAppendOnlyViolations(source)).toEqual([]);
  });
});
