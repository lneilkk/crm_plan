import "server-only";

import { parseConsent, parseDateKey, parseTime } from "@/lib/import/values";
import { kstDateTime } from "@/lib/time/kst";
import { containsResidentRegistrationNumber } from "@/lib/validation/forbidden-text";
import type { DbClient } from "@/server/db";
import { addError, bump, emptyReport, type ImportReport, type ImportRow, patientMatcher, splitList, staffByName } from "./shared";

/**
 * 상담 기록 가져오기 — F-7(T9-4 일부).
 * - 상담 내용은 민감정보다(기획서 10장). 파일의 '민감정보 동의' 칸이 Y·예·동의인 행만 넣고, 나머지는 '동의 미확인'으로 건너뛴다.
 *   넣을 때 그 고객에게 민감정보 동의 기록이 없으면 하나 남긴다(동의 일시 = 상담일, 기록자 = 가져오는 관리자).
 * - 상담자는 직원 이름으로 찾고, 없으면 가져오는 관리자로 넣고 보고서에 센다.
 * - 같은 고객·같은 상담 시각의 기록이 있으면 건너뛴다(같은 파일을 두 번 넣어도 중복 없음).
 * - 내용에 주민등록번호 모양이 있으면 그 행은 넣지 않는다(절대 규칙 3).
 */

const CONTENT_MAX = 4000;

function parseResult(text: string): "BOOKED" | "NOT_BOOKED" | "PENDING" {
  const t = text.replace(/\s+/g, "");
  if (/미전환|미예약|거절|안함|포기/.test(t)) return "NOT_BOOKED";
  if (/예약|전환|진행|동의/.test(t)) return "BOOKED";
  return "PENDING";
}

export async function importConsultations(
  client: DbClient,
  rows: ImportRow[],
  options: { dryRun: boolean; firstRow: number; actorId: string },
): Promise<{ report: ImportReport; patientIds: string[] }> {
  const report = emptyReport(options.dryRun, rows.length);
  const match = await patientMatcher(client, rows);
  const counselorOf = await staffByName(client, ["COUNSELOR", "ADMIN"]);
  const patientIds = new Set<string>();
  const seen = new Set<string>();
  const consentChecked = new Map<string, boolean>();

  for (const [index, row] of rows.entries()) {
    const rowNo = options.firstRow + index;
    if (!parseConsent(row.consent ?? "")) { bump(report.skipped, "CONSENT_MISSING"); continue; }
    const patient = match(row);
    if (!patient) { addError(report, rowNo, "PATIENT_NOT_FOUND"); continue; }
    const date = parseDateKey(row.date ?? "");
    if (!date) { addError(report, rowNo, "DATE_INVALID"); continue; }
    const timeText = (row.time ?? "").trim() || ((row.date ?? "").includes(":") ? row.date : "");
    const time = timeText ? parseTime(timeText) : "09:00";
    if (!time) { addError(report, rowNo, "TIME_INVALID"); continue; }
    const content = (row.content ?? "").trim();
    if (!content) { addError(report, rowNo, "CONTENT_MISSING"); continue; }
    if (containsResidentRegistrationNumber(content)) { addError(report, rowNo, "RRN_IN_CONTENT"); continue; }
    const consultedAt = kstDateTime(date, time);

    const key = `${patient.id}|${consultedAt.getTime()}`;
    if (seen.has(key) || (await client.consultation.count({ where: { patientId: patient.id, consultedAt } })) > 0) {
      report.existing += 1;
      patientIds.add(patient.id);
      continue;
    }
    seen.add(key);
    const counselorText = (row.counselor ?? "").trim();
    let counselorId = counselorOf(counselorText);
    if (!counselorId) {
      bump(report.notes, "COUNSELOR_FALLBACK");
      counselorId = options.actorId;
    }
    report.created += 1;
    patientIds.add(patient.id);
    if (options.dryRun) continue;

    if (!consentChecked.has(patient.id)) {
      const has = (await client.consent.count({ where: { patientId: patient.id, type: "SENSITIVE", agreed: true } })) > 0;
      if (!has) {
        await client.consent.create({
          data: { patientId: patient.id, type: "SENSITIVE", agreed: true, agreedAt: consultedAt, recordedById: options.actorId },
        });
        bump(report.notes, "CONSENT_RECORDED");
      }
      consentChecked.set(patient.id, true);
    }
    await client.consultation.create({
      data: {
        patientId: patient.id,
        counselorId,
        content: content.slice(0, CONTENT_MAX),
        interestedItems: splitList(row.items, 10, 30),
        result: parseResult(row.result ?? ""),
        consultedAt,
      },
    });
  }
  return { report, patientIds: [...patientIds] };
}
