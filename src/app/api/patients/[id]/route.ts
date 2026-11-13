import { defineRoute } from "@/server/api/define-route";
import { ApiError } from "@/server/api/errors";
import { patientIdParams, updatePatientBody } from "@/server/patients/schema";
import { getPatientDetail, NOT_FOUND_MESSAGE, updatePatient } from "@/server/patients/service";
import { duplicatePhoneResponse } from "@/server/patients/responses";

/** 고객 상세 — 복호화한 번호·생년월일, 메모, 예약 이력(최근 순, 최대 50건) */
export const GET = defineRoute({
  permission: "patient.read",
  audit: "PATIENT_READ",
  params: patientIdParams,
  handler: async (ctx) => {
    const detail = await getPatientDetail(ctx.params.id);
    if (!detail) throw new ApiError(404, "NOT_FOUND", NOT_FOUND_MESSAGE);
    ctx.touchPatients([detail.patient.id]);
    return detail;
  },
});

/** 고객 수정 — 보낸 필드만 바꾼다. 번호를 다른 고객의 번호로 바꾸면 등록과 같은 경고(409)를 준다. */
export const PATCH = defineRoute({
  permission: "patient.write",
  audit: "PATIENT_UPDATE",
  params: patientIdParams,
  body: updatePatientBody,
  handler: async (ctx) => {
    // 실패(404·차트번호 중복 등)한 시도도 대상 고객이 감사 행에 남도록 먼저 알린다.
    ctx.touchPatients([ctx.params.id]);
    const result = await updatePatient(ctx.params.id, ctx.body, ctx.db);
    if (result.kind === "duplicatePhone") return duplicatePhoneResponse(ctx, result.duplicates);
    ctx.audit({ fields: Object.keys(ctx.body).filter((key) => key !== "confirmDuplicate").length });
    return { id: result.id };
  },
});
