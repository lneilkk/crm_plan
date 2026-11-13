/**
 * 화면 코드에서 역할·부서를 직접 비교하거나 권한 이름을 직접 검사하지 않는다 — 확장 계획 S-3.
 * 화면은 화면 등록부(src/lib/auth/screen-registry.ts)의 영역 이름으로만 묻는다(<Allowed area>, useAccess, allowsArea).
 * 그래야 관리자가 직무별 권한을 바꿨을 때(DB) 화면이 그대로 따라온다.
 *
 * 허용: 역할 값으로 목록을 고르는 조회(`/api/staff?role=DOCTOR`), 역할 이름·색을 보여 주는 표 조회(`LABEL[role]`),
 * 편집 양식의 값 비교(`role !== account.role`).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCANNED = [join(ROOT, "src/components"), join(ROOT, "src/app")];
/** 권한 이름을 직접 다뤄도 되는 곳: 등록부를 읽는 훅·컴포넌트 */
const PERMISSION_CHECK_ALLOWED = [join(ROOT, "src/components/auth")];

const NAMES = "FRONT|COUNSELOR|DOCTOR|NURSE|ADMIN|CONSULT|CLINICAL|OPERATIONS";
const RULES: { name: string; pattern: RegExp; permissionRule?: boolean }[] = [
  { name: "역할·부서 값과 비교", pattern: new RegExp(`(===|!==|==|!=)\\s*["'\`](${NAMES})["'\`]`) },
  { name: "역할·부서 값과 비교(왼쪽)", pattern: new RegExp(`["'\`](${NAMES})["'\`]\\s*(===|!==|==|!=)`) },
  { name: "역할·부서 목록으로 포함 검사", pattern: new RegExp(`\\[[^\\]]*["'](${NAMES})["'][^\\]]*\\]\\s*\\.(includes|indexOf|some|find)\\(`) },
  { name: "역할·부서로 switch", pattern: /switch\s*\(\s*[\w.?]*(role|department)\s*\)/i },
  { name: "역할·부서 case", pattern: new RegExp(`case\\s+["'](${NAMES})["']\\s*:`) },
  { name: "권한 목록 직접 검사", pattern: /\bpermissions\s*\.\s*(includes|indexOf|some)\s*\(/, permissionRule: true },
  { name: "권한 이름 직접 검사", pattern: /\.(includes|has)\(\s*["'][a-z]+\.[a-z]+["']\s*\)/, permissionRule: true },
  { name: "권한 계산 함수 직접 호출", pattern: /\b(hasPermission|permissionsOf)\s*\(/, permissionRule: true },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return full.endsWith(join("src", "app", "api")) ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

function violations(file: string, text: string): string[] {
  const permissionAllowed = PERMISSION_CHECK_ALLOWED.some((dir) => file.startsWith(dir));
  return text.split("\n").flatMap((line, index) => {
    const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
    return RULES.filter((rule) => !(rule.permissionRule && permissionAllowed) && rule.pattern.test(code)).map(
      (rule) => `${relative(ROOT, file)}:${index + 1} ${rule.name}: ${line.trim()}`,
    );
  });
}

describe("화면 코드에 역할 직접 비교·권한 직접 검사가 없다", () => {
  it("src/components·src/app(API 제외) 전체", () => {
    const found = SCANNED.flatMap(sourceFiles).flatMap((file) => violations(file, readFileSync(file, "utf8")));
    expect(found).toEqual([]);
  });

  it("검사기가 금지 모양을 잡는다 (검사기 자체 시험)", () => {
    const bad = [
      'if (me.role === "ADMIN") show();',
      'const isFront = "FRONT" === staff.role;',
      'if (["COUNSELOR", "ADMIN"].includes(role)) {}',
      "switch (me.data.role) {}",
      '  case "DOCTOR":',
      'const ok = department !== "CLINICAL";',
      'const can = me.data.permissions.includes("stats.read");',
      'if (set.has("consult.write")) {}',
      "const p = permissionsOf(access);",
    ];
    for (const line of bad) expect(violations(join(ROOT, "src/components/x.tsx"), line).length, line).toBeGreaterThan(0);
    const good = [
      'apiFetch("/api/staff?role=DOCTOR")',
      'queryKey: ["staff", "COUNSELOR"],',
      "const tone = PARTICIPANT_TONE[p.role];",
      "const changed = role !== account.role;",
      'const canWrite = allowsArea(me.data.permissions, "consult.write");',
      '// 예: role === "ADMIN" 은 쓰지 않는다',
    ];
    for (const line of good) expect(violations(join(ROOT, "src/components/x.tsx"), line), line).toEqual([]);
    expect(violations(join(ROOT, "src/components/auth/access.tsx"), "granted.includes(permission)")).toEqual([]);
  });
});
