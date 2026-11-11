/**
 * 고객 도메인 상수 — 기획서 6장(patient, consent) 기준.
 * 서버·브라우저 공용. DB enum(prisma/schema.prisma)과 값이 같아야 한다.
 */

export const GENDERS = ["MALE", "FEMALE"] as const;

export type Gender = (typeof GENDERS)[number];

export const GENDER_LABEL: Record<Gender, string> = {
  MALE: "남",
  FEMALE: "여",
};

/** 신규/재진 — 등록 시점의 구분. 화면 배지는 이 값과 과거 내원 이력을 함께 본다. */
export const VISIT_TYPES = ["NEW", "RETURNING"] as const;

export type VisitType = (typeof VISIT_TYPES)[number];

export const VISIT_TYPE_LABEL: Record<VisitType, string> = {
  NEW: "신규",
  RETURNING: "재진",
};

/** 유입경로 — 고객이 병원을 알게 된 경로 (기획서 4-4: 전화·홈페이지·플랫폼 앱·소개) */
export const REFERRAL_SOURCES = ["PHONE", "WEBSITE", "PLATFORM", "REFERRAL", "OTHER"] as const;

export type ReferralSource = (typeof REFERRAL_SOURCES)[number];

export const REFERRAL_SOURCE_LABEL: Record<ReferralSource, string> = {
  PHONE: "전화",
  WEBSITE: "홈페이지",
  PLATFORM: "플랫폼 앱",
  REFERRAL: "소개",
  OTHER: "기타",
};

/** 동의 종류 — 한 체크박스로 묶지 않고 종류별로 따로 기록한다 (기획서 7장) */
export const CONSENT_TYPES = ["PRIVACY", "SENSITIVE", "MARKETING"] as const;

export type ConsentType = (typeof CONSENT_TYPES)[number];

export const CONSENT_TYPE_LABEL: Record<ConsentType, string> = {
  PRIVACY: "개인정보 수집·이용",
  SENSITIVE: "민감정보 처리",
  MARKETING: "마케팅 수신",
};
