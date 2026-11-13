import { defineRoute } from "@/server/api/define-route";
import { createPatientBody, searchPatientsQuery } from "@/server/patients/schema";
import { createPatient, searchPatients } from "@/server/patients/service";
import { duplicatePhoneResponse, existingPatientResponse } from "@/server/patients/responses";

/**
 * 고객 검색 — T3-2. 전화번호 뒷 4자리·전체 번호·차트번호·이름. 목록은 이름·번호를 마스킹한다.
 * 감사 행에는 검색 방식 코드와 건수만 남기고 검색어는 남기지 않는다.
 * 내원 보드는 kind=phoneLast4&appointmentDate=<그날>로 부른다: 번호 뒷 4자리만, 그날 예약한 고객 중에서만 찾는다.
 */
export const GET = defineRoute({
  permission: "patient.read",
  audit: "PATIENT_SEARCH",
  query: searchPatientsQuery,
  handler: async (ctx) => {
    const { kind, items } = await searchPatients(ctx.query.q, {
      limit: ctx.query.limit,
      kind: ctx.query.kind,
      appointmentDate: ctx.query.appointmentDate,
      newOnly: ctx.query.newOnly === "1",
    });
    ctx.touchPatients(items.map((item) => item.id));
    ctx.audit({ searchKind: kind });
    return { items };
  },
});

/**
 * 고객 등록 — T3-1. 같은 번호의 고객이 있으면 저장하지 않고 409 DUPLICATE_PHONE으로 경고한다.
 * 화면이 확인을 받아 confirmDuplicate: true로 다시 보내면 등록한다(가족이 번호를 함께 쓰는 경우).
 */
export const POST = defineRoute({
  permission: "patient.write",
  audit: "PATIENT_CREATE",
  body: createPatientBody,
  handler: async (ctx) => {
    const result = await createPatient(ctx.body, ctx.staff.id, ctx.db);
    if (result.kind === "duplicatePhone") return duplicatePhoneResponse(ctx, result.duplicates);
    if (result.kind === "existingPatient") return existingPatientResponse(ctx, result.existing);
    ctx.touchPatients([result.id]);
    ctx.audit({ confirmedDuplicate: ctx.body.confirmDuplicate === true });
    return Response.json({ id: result.id }, { status: 201 });
  },
});
