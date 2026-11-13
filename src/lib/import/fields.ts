import { isResidentNumberHeader } from "./values";

/**
 * 가져오기 대상 항목 — F-7. 엑셀 열을 어느 항목에 넣을지(매핑) 화면이 고르고, 서버는 항목 키로 받는다.
 * guess는 첫 줄(열 이름)로 자동 매핑할 때 쓴다. 주민등록번호 열은 어떤 항목에도 매핑하지 않는다(절대 규칙 3).
 */

export const IMPORT_KINDS = ["patients", "appointments", "consultations"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const IMPORT_KIND_LABEL: Record<ImportKind, string> = {
  patients: "고객 기본 정보",
  appointments: "예약·내원 이력",
  consultations: "상담 기록",
};

export type ImportField = { key: string; label: string; required: boolean; guess: RegExp; hint?: string };

const NAME: ImportField = { key: "name", label: "이름", required: true, guess: /^(이름|성명|고객명|환자명|name)$/i };
const PHONE: ImportField = { key: "phone", label: "휴대폰", required: false, guess: /휴대|핸드폰|전화|연락처|phone|mobile/i };
const CHART: ImportField = { key: "chartNo", label: "차트번호", required: false, guess: /차트|chart/i };

export const IMPORT_FIELDS: Record<ImportKind, ImportField[]> = {
  patients: [
    NAME,
    { ...PHONE, required: true },
    { key: "birthDate", label: "생년월일", required: false, guess: /생년|생일|birth/i },
    { key: "gender", label: "성별", required: false, guess: /성별|gender|sex/i },
    CHART,
    { key: "referral", label: "유입경로", required: false, guess: /유입|경로|소개|referral/i },
    { key: "tags", label: "태그", required: false, guess: /태그|분류|tag/i, hint: "쉼표로 나눈 여러 값" },
    { key: "memo", label: "메모", required: false, guess: /메모|비고|특이|memo|note/i },
  ],
  appointments: [
    NAME,
    { ...PHONE, hint: "차트번호가 없으면 이름+휴대폰으로 고객을 찾습니다" },
    CHART,
    { key: "date", label: "예약일", required: true, guess: /예약일|일자|날짜|date|예약일시/i },
    { key: "time", label: "시각", required: false, guess: /시각|시간|time/i, hint: "없으면 09:00" },
    { key: "duration", label: "소요시간(분)", required: false, guess: /소요|duration/i, hint: "없으면 30분" },
    { key: "item", label: "예약 항목", required: false, guess: /항목|진료|치료|item/i },
    { key: "status", label: "상태", required: false, guess: /상태|결과|내원|status/i, hint: "내원·노쇼·취소·예약 등" },
    { key: "doctor", label: "의사", required: false, guess: /의사|원장|담당의|doctor/i, hint: "직원 이름과 같아야 연결" },
    { key: "chair", label: "체어", required: false, guess: /체어|진료실|chair/i },
    { key: "channel", label: "예약 경로", required: false, guess: /채널|예약경로|접수경로|channel/i },
    { key: "memo", label: "메모", required: false, guess: /메모|비고|memo/i },
  ],
  consultations: [
    NAME,
    { ...PHONE, hint: "차트번호가 없으면 이름+휴대폰으로 고객을 찾습니다" },
    CHART,
    { key: "date", label: "상담일", required: true, guess: /상담일|일자|날짜|date/i },
    { key: "time", label: "시각", required: false, guess: /시각|시간|time/i },
    { key: "counselor", label: "상담자", required: false, guess: /상담자|상담사|실장|counselor/i, hint: "직원 이름과 같아야 연결, 없으면 가져오는 관리자" },
    { key: "content", label: "상담 내용", required: true, guess: /상담내용|내용|content/i },
    { key: "items", label: "관심 항목", required: false, guess: /관심|희망|interest/i, hint: "쉼표로 나눈 여러 값" },
    { key: "result", label: "결과", required: false, guess: /결과|진행|result/i, hint: "예약·미전환 등" },
    { key: "consent", label: "민감정보 동의", required: true, guess: /동의|consent/i, hint: "Y·예·동의인 행만 가져옵니다" },
  ],
};

/** 열 이름으로 항목별 열 번호를 추측한다. 주민번호 열은 쓰지 않고, 한 열은 한 항목에만 쓴다. */
export function guessMapping(kind: ImportKind, headers: string[]): Record<string, number | null> {
  const used = new Set<number>();
  const mapping: Record<string, number | null> = {};
  for (const field of IMPORT_FIELDS[kind]) {
    const index = headers.findIndex((header, i) => !used.has(i) && !isResidentNumberHeader(header) && field.guess.test(header.replace(/\s+/g, "")));
    mapping[field.key] = index >= 0 ? index : null;
    if (index >= 0) used.add(index);
  }
  return mapping;
}

/** 한 번에 보내는 행 수 (요청 크기 한도 안) */
export const IMPORT_CHUNK_ROWS = 500;
