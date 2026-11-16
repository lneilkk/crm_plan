/**
 * 자유 입력(메모)에 넣으면 안 되는 내용 — 절대 규칙 3(주민등록번호·진료기록을 저장하지 않는다).
 * 서버(zod 스키마)와 화면(제출 전 확인)이 함께 쓴다.
 *
 * 주민등록번호 모양: 생년월일 6자리(YYMMDD, 월 01~12·일 01~31) + 성별 자리 1~8 + 6자리.
 * 가운데 하이픈·공백은 있어도 없어도 된다. 앞뒤가 숫자로 이어지면(더 긴 숫자열) 주민등록번호로 보지 않는다.
 * 전화번호(010-0123-4567)는 자릿수가 달라 걸리지 않는다.
 * 진단·처방 같은 진료 내용은 글자 모양으로 가려낼 수 없어 화면 안내 문구로만 막는다.
 */

const RRN_PATTERN = /(?<!\d)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[\s-]*[1-8]\d{6}(?!\d)/;

/** 검증 실패 응답의 필드 오류 코드(zod refine message). 입력값은 응답에 넣지 않는다. */
export const RRN_FIELD_CODE = "resident_registration_number";

/** 메모 안내 문구 — 고객 메모와 예약 메모가 같이 쓴다 */
export const MEMO_GUIDE = "진단·처방 같은 진료 내용이나 주민등록번호는 적지 않습니다.";

/** 화면 오류 문구 */
export const RRN_ERROR_MESSAGE = "메모에 주민등록번호를 적을 수 없습니다. 지우고 다시 저장하세요.";

export function containsResidentRegistrationNumber(text: string): boolean {
  return RRN_PATTERN.test(text);
}
