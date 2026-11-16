import { z } from "zod";
import { IMPORT_CHUNK_ROWS, IMPORT_KINDS } from "@/lib/import/fields";
import { defineRoute } from "@/server/api/define-route";
import { importAppointments } from "@/server/import/appointments";
import { importConsultations } from "@/server/import/consultations";
import { importPatients } from "@/server/import/patients";

/**
 * 기존 CRM 엑셀 가져오기 — F-7(Task.md M9 일부), 관리자만.
 * 화면이 엑셀을 브라우저에서 읽어 매핑한 칸만 묶음(최대 IMPORT_CHUNK_ROWS행)으로 보낸다. 주민번호 열은 보내지 않는다.
 * dryRun이면 쓰지 않고 보고서만 돌려준다. 같은 묶음을 다시 보내도 중복이 생기지 않는다.
 * 감사 행: 종류·건수·시험 실행 여부(원문 없음), 다룬 고객 수.
 *
 * 실제 환자 데이터는 R3(보안 게이트)를 통과한 운영 서버에서만 넣는다(절대 규칙 1, Task.md) — 프로토타입 서버는 가짜 파일만.
 */
const cell = z.string().max(4000);
const body = z.strictObject({
  dryRun: z.boolean(),
  /** 이 묶음 첫 행의 엑셀 행 번호(보고서용) */
  firstRow: z.number().int().min(1),
  rows: z.array(z.record(z.string().max(30), cell)).min(1).max(IMPORT_CHUNK_ROWS),
});

export const POST = defineRoute({
  permission: "data.import",
  audit: "DATA_IMPORT",
  params: z.object({ kind: z.enum(IMPORT_KINDS) }),
  body,
  maxBodyBytes: 4 * 1024 * 1024,
  handler: async (ctx) => {
    const options = { dryRun: ctx.body.dryRun, firstRow: ctx.body.firstRow, actorId: ctx.staff.id, now: ctx.now };
    const run =
      ctx.params.kind === "patients" ? importPatients : ctx.params.kind === "appointments" ? importAppointments : importConsultations;
    const { report, patientIds } = await run(ctx.db, ctx.body.rows, options);
    ctx.touchPatients(patientIds);
    ctx.audit({
      kind: ctx.params.kind,
      dryRun: report.dryRun,
      rows: report.total,
      created: report.created,
      existing: report.existing,
      errors: report.total - report.created - report.existing - (report.skipped.CONSENT_MISSING ?? 0),
    });
    return report;
  },
});
