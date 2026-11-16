/**
 * 직원 비밀번호 규칙 — F-1(비밀번호 변경). 화면(입력 중 안내)과 서버(최종 검사)가 같은 함수를 쓴다.
 *
 * 「개인정보의 안전성 확보조치 기준」 해설서의 권고를 따른다:
 * 영문 대문자·소문자·숫자·특수문자 중 2종류 이상이면 10자 이상, 3종류 이상이면 8자 이상.
 * 그 밖에 아이디가 들어 있는 비밀번호, 앞뒤 공백(복사·붙여넣기 실수), 128자 초과(해시 계산 부담)를 막는다.
 * 결과는 규칙 코드 목록뿐이다. 비밀번호 글자를 결과·로그·에러에 넣지 않는다.
 */

export const PASSWORD_MAX_LENGTH = 128;

export type PasswordRule = "TOO_SHORT" | "TOO_FEW_CLASSES" | "TOO_LONG" | "CONTAINS_LOGIN_ID" | "LEADING_OR_TRAILING_SPACE";

/** 화면에 보여 줄 규칙 설명 */
export const PASSWORD_RULE_MESSAGES: Record<PasswordRule, string> = {
  TOO_SHORT: "영문·숫자·특수문자 중 2종류를 섞으면 10자 이상, 3종류 이상이면 8자 이상이어야 합니다.",
  TOO_FEW_CLASSES: "영문 대문자·소문자·숫자·특수문자 중 2종류 이상을 섞어야 합니다.",
  TOO_LONG: `${PASSWORD_MAX_LENGTH}자 이하로 정하세요.`,
  CONTAINS_LOGIN_ID: "아이디가 들어간 비밀번호는 쓸 수 없습니다.",
  LEADING_OR_TRAILING_SPACE: "앞뒤에 공백을 넣을 수 없습니다.",
};

export const PASSWORD_RULE_SUMMARY = "영문·숫자·특수문자 중 2종류 이상 10자 이상(3종류 이상이면 8자 이상), 아이디 포함 불가";

/** 영문 대문자·소문자·숫자·그 밖의 글자(특수문자·한글 등) 중 몇 종류가 쓰였는지 */
export function passwordCharClasses(password: string): number {
  let classes = 0;
  if (/[A-Z]/.test(password)) classes++;
  if (/[a-z]/.test(password)) classes++;
  if (/[0-9]/.test(password)) classes++;
  if (/[^A-Za-z0-9]/.test(password)) classes++;
  return classes;
}

/** 지키지 못한 규칙 코드 목록. 빈 배열이면 통과 */
export function checkPasswordPolicy(password: string, context: { loginId: string }): PasswordRule[] {
  const failed: PasswordRule[] = [];
  const length = [...password].length;
  const classes = passwordCharClasses(password);

  if (length > PASSWORD_MAX_LENGTH) failed.push("TOO_LONG");
  if (classes < 2) failed.push("TOO_FEW_CLASSES");
  else if (length < (classes >= 3 ? 8 : 10)) failed.push("TOO_SHORT");
  if (password !== password.trim()) failed.push("LEADING_OR_TRAILING_SPACE");
  const loginId = context.loginId.trim().toLowerCase();
  if (loginId.length > 0 && password.toLowerCase().includes(loginId)) failed.push("CONTAINS_LOGIN_ID");
  return failed;
}
