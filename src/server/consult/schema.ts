import { z } from "zod";
import { containsResidentRegistrationNumber, RRN_FIELD_CODE } from "@/lib/validation/forbidden-text";

/** 상담 입력 검증 (F-10) — 내용에 주민등록번호 모양이 있으면 거부한다(절대 규칙 3). */
export const consultContent = z
  .string()
  .trim()
  .min(1)
  .max(4000)
  .refine((v) => !containsResidentRegistrationNumber(v), { message: RRN_FIELD_CODE });

export const interestedItems = z.array(z.string().trim().min(1).max(30)).max(10);
