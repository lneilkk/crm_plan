import { describe, expect, it } from "vitest";
import { checkPasswordPolicy, PASSWORD_MAX_LENGTH, passwordCharClasses } from "./password-policy";

describe("passwordCharClasses", () => {
  it("영문 대문자·소문자·숫자·특수문자 종류 수를 센다", () => {
    expect(passwordCharClasses("abc")).toBe(1);
    expect(passwordCharClasses("abc123")).toBe(2);
    expect(passwordCharClasses("Abc123")).toBe(3);
    expect(passwordCharClasses("Abc123!")).toBe(4);
    expect(passwordCharClasses("가나다123")).toBe(2); // 한글 등 그 밖의 글자는 특수문자로 센다
  });
});

describe("checkPasswordPolicy", () => {
  const ok = (password: string) => expect(checkPasswordPolicy(password, { loginId: "front1" })).toEqual([]);
  const fails = (password: string, code: string) =>
    expect(checkPasswordPolicy(password, { loginId: "front1" })).toContain(code);

  it("2종류 조합은 10자 이상이면 통과, 9자는 거부", () => {
    ok("abcdefg123");
    fails("abcdefg12", "TOO_SHORT");
  });

  it("3종류 이상 조합은 8자 이상이면 통과, 7자는 거부", () => {
    ok("Abcde12!");
    ok("Abcdef12");
    fails("Abcd12!", "TOO_SHORT");
  });

  it("한 종류만 쓰면 길어도 거부", () => {
    fails("abcdefghijklmnop", "TOO_FEW_CLASSES");
    fails("1234567890123", "TOO_FEW_CLASSES");
  });

  it("아이디가 들어 있으면 대소문자와 상관없이 거부", () => {
    fails("FRONT1-clinic", "CONTAINS_LOGIN_ID");
    fails("myfront1pass!", "CONTAINS_LOGIN_ID");
  });

  it("너무 길면 거부(해시 계산 부담)", () => {
    ok(`Aa1${"x".repeat(PASSWORD_MAX_LENGTH - 3)}`);
    fails(`Aa1${"x".repeat(PASSWORD_MAX_LENGTH - 2)}`, "TOO_LONG");
  });

  it("앞뒤 공백은 실수로 보고 거부", () => {
    fails(" abcdefg123", "LEADING_OR_TRAILING_SPACE");
    fails("abcdefg123 ", "LEADING_OR_TRAILING_SPACE");
  });

  it("결과에는 규칙 코드만 있고 비밀번호 글자는 없다", () => {
    const result = checkPasswordPolicy("short", { loginId: "front1" });
    expect(result.join(" ")).not.toContain("short");
  });
});
