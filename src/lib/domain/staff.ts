/**
 * 직원 역할 — 기획서 6장(staff), 10장(권한) 기준.
 * 서버·브라우저 공용. DB enum(prisma/schema.prisma)과 값이 같아야 한다.
 */

/** NURSE(간호): 수술 참여 기록 등 (F-11, 2026-11-12 추가) */
export const STAFF_ROLES = ["FRONT", "COUNSELOR", "DOCTOR", "NURSE", "ADMIN"] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  FRONT: "프론트",
  COUNSELOR: "상담",
  DOCTOR: "의사",
  NURSE: "간호",
  ADMIN: "관리자",
};
