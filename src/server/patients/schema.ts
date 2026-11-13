import "server-only";

import { z } from "zod";
import { GENDERS, REFERRAL_SOURCES, VISIT_TYPES } from "@/lib/domain/patient";
import { isLast4Query, normalizePhone } from "@/lib/phone";
import { isValidDateKey } from "@/lib/time/kst";
import { containsResidentRegistrationNumber, RRN_FIELD_CODE } from "@/lib/validation/forbidden-text";

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
  /**
   * 차트번호는 대문자로 바꿔 저장한다(앞뒤 공백 제거 포함). 저장·중복 검사(unique 제약 포함)·검색이
   * 같은 기준을 쓰도록 — 그렇지 않으면 "F100002"와 "f100002"가 서로 다른 고객에게 등록될 수 있다.
   */
  dentwebChartNo: optionalText(CHART_NO_MAX).transform((value) => (value == null ? value : value.toUpperCase())),
  /** 주민등록번호 모양이 있으면 거부한다(절대 규칙 3). 오류에는 필드 경로만 담긴다. */
  memo: optionalText(MEMO_MAX).refine((value) => value == null || !containsResidentRegistrationNumber(value), {
    message: RRN_FIELD_CODE,
  }),
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

/**
 * GET /api/patients
 * - kind 없음: 검색어 모양으로 방식을 고른다(뒷 4자리·전체 번호·차트번호·이름).
 * - kind=phoneLast4: 전화번호 뒷 4자리만 찾는다(숫자 차트번호와 섞지 않는다). q는 숫자 4개여야 한다.
 * - appointmentDate(YYYY-MM-DD, 한국 시간): 그날 시작하는 예약이 있는 고객으로 좁힌다. 내원 보드 빠른 검색용이라
 *   kind=phoneLast4와 함께일 때만 받는다(빈 검색어로 그날 고객 전체를 상한 없이 받는 목록이 되지 않게).
 *   이때 결과는 "그날 예약 + 같은 뒷 4자리" 고객뿐이므로 limit을 적용하지 않는다(상한 때문에 그날 고객이 빠지지 않게).
 */
export const PATIENT_SEARCH_KINDS = ["phoneLast4"] as const;

export const searchPatientsQuery = z
  .object({
    q: z.string().max(100).default(""),
    limit: z.coerce.number().int().min(1).max(SEARCH_LIMIT_MAX).default(SEARCH_LIMIT_DEFAULT),
    kind: z.enum(PATIENT_SEARCH_KINDS).optional(),
    appointmentDate: z.string().refine(isValidDateKey, { message: "날짜 형식" }).optional(),
    /** "1"이면 신환만 (F-4) */
    newOnly: z.literal("1").optional(),
  })
  .refine((query) => query.kind !== "phoneLast4" || isLast4Query(query.q), {
    message: "뒷 4자리 형식",
    path: ["q"],
  })
  .refine((query) => query.appointmentDate === undefined || query.kind === "phoneLast4", {
    message: "날짜는 뒷 4자리 검색에서만",
    path: ["appointmentDate"],
  });

export type SearchPatientsQuery = z.output<typeof searchPatientsQuery>;

export const patientIdParams = z.object({ id: z.uuid() });
