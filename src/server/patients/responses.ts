import "server-only";

import type { AuditDetail } from "@/server/api/audit";
import { DUPLICATE_PHONE_MESSAGE, type DuplicatePatient } from "./service";

/**
 * 같은 번호 경고 응답 (409 DUPLICATE_PHONE). 차단이 아니라 경고다 — 화면이 "그래도 등록"으로 다시 보낼 수 있다.
 * duplicates는 응답 최상위에 두고, 브라우저의 apiFetch(ApiRequestError.details)가 읽을 수 있게 error 안에도 넣는다.
 * 마스킹한 이름·출생 연도만 담는다. 보여 준 고객도 감사 행의 patientCount에 센다.
 */
export function duplicatePhoneResponse(
  ctx: { touchPatients(ids: readonly string[]): void; audit(extra: AuditDetail): void },
  duplicates: DuplicatePatient[],
): Response {
  ctx.touchPatients(duplicates.map((d) => d.id));
  ctx.audit({ errorCode: "DUPLICATE_PHONE", duplicateCount: duplicates.length });
  return Response.json(
    { error: { code: "DUPLICATE_PHONE", message: DUPLICATE_PHONE_MESSAGE, duplicates }, duplicates },
    { status: 409, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * 이름·번호가 모두 같은 고객이 이미 있음 (409 EXISTING_PATIENT, F-4). 새로 만들지 않는다.
 * 화면은 이 고객(구환)을 고르거나 고객 상세로 간다. 마스킹한 이름만 담고, 알려 준 고객을 감사 행에 남긴다.
 */
export function existingPatientResponse(
  ctx: { touchPatients(ids: readonly string[]): void; audit(extra: AuditDetail): void },
  existing: { id: string; nameMasked: string },
): Response {
  ctx.touchPatients([existing.id]);
  ctx.audit({ errorCode: "EXISTING_PATIENT" });
  return Response.json(
    {
      error: {
        code: "EXISTING_PATIENT",
        message: "이름과 번호가 같은 고객이 이미 있습니다(구환). 새로 등록하지 않고 기존 고객을 씁니다.",
        existing,
      },
    },
    { status: 409, headers: { "Cache-Control": "no-store" } },
  );
}
