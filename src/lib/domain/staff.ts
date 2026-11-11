/**
 * 직원 역할 — 기획서 6장(staff), 10장(권한) 기준.
 * 서버·브라우저 공용. DB enum(prisma/schema.prisma)과 값이 같아야 한다.
 */

export const STAFF_ROLES = ["FRONT", "COUNSELOR", "DOCTOR", "ADMIN"] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  FRONT: "프론트",
  COUNSELOR: "상담",
  DOCTOR: "의사",
  ADMIN: "관리자",
};
