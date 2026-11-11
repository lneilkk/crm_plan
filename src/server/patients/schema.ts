import "server-only";

import { z } from "zod";
import { GENDERS, REFERRAL_SOURCES, VISIT_TYPES } from "@/lib/domain/patient";
import { normalizePhone } from "@/lib/phone";
import { isValidDateKey } from "@/lib/time/kst";

/**
 * 고객 API 입력 검증 — T3-1·T3-2.
 * 검증 실패 응답에는 필드 경로만 담긴다(defineRoute). 여기 메시지도 값을 담지 않는다.
 */

export const NAME_MAX = 50;
export const CHART_NO_MAX = 30;
export const MEMO_MAX = 1000;
export const TAG_MAX = 20;
export const TAGS_MAX = 10;
export const SEARCH_LIMIT_MAX = 50;
export const SEARCH_LIMIT_DEFAULT = 20;

/** 빈 문자열은 "값 없음"(null)으로 받는다. 보내지 않은 필드(undefined)는 그대로 둔다(PATCH에서 바꾸지 않음). */
const emptyToNull = (value: string | null | undefined) => (value === undefined ? undefined : value || null);

const optionalText = (max: number) => z.string().trim().max(max).nullish().transform(emptyToNull);

const patientFields = {
  name: z.string().trim().min(1).max(NAME_MAX),
  phone: z.string().max(30).refine((value) => normalizePhone(value) !== null, { message: "전화번호 형식" }),
  birthDate: z
    .string()
    .trim()
    .nullish()
    .transform(emptyToNull)
    .refine((value) => value == null || isValidDateKey(value), { message: "생년월일 형식" }),
  gender: z.enum(GENDERS).nullish(),
  referralSource: z.enum(REFERRAL_SOURCES).nullish(),
  tags: z
    .array(z.string().trim().min(1).max(TAG_MAX))
    .max(TAGS_MAX)
    .transform((tags) => [...new Set(tags)]),
  dentwebChartNo: optionalText(CHART_NO_MAX),
  memo: optionalText(MEMO_MAX),
  visitType: z.enum(VISIT_TYPES),
};

/** POST /api/patients */
export const createPatientBody = z.object({
  ...patientFields,
  tags: patientFields.tags.optional(),
  visitType: patientFields.visitType.optional(),
  /** 같은 번호의 고객이 있다는 경고를 보고도 등록한다 (가족이 번호를 함께 쓰는 경우) */
  confirmDuplicate: z.boolean().optional(),
});

/** PATCH /api/patients/[id] — 보낸 필드만 바꾼다 */
export const updatePatientBody = z.object({
  name: patientFields.name.optional(),
  phone: patientFields.phone.optional(),
  birthDate: patientFields.birthDate.optional(),
  gender: patientFields.gender,
  referralSource: patientFields.referralSource,
  tags: patientFields.tags.optional(),
  dentwebChartNo: patientFields.dentwebChartNo.optional(),
  memo: patientFields.memo.optional(),
  visitType: patientFields.visitType.optional(),
  confirmDuplicate: z.boolean().optional(),
});

export type CreatePatientInput = z.output<typeof createPatientBody>;
export type UpdatePatientInput = z.output<typeof updatePatientBody>;

/** GET /api/patients */
export const searchPatientsQuery = z.object({
  q: z.string().max(100).default(""),
  limit: z.coerce.number().int().min(1).max(SEARCH_LIMIT_MAX).default(SEARCH_LIMIT_DEFAULT),
});

export const patientIdParams = z.object({ id: z.uuid() });
