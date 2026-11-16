import "server-only";

import { parseDateKey, parseGender, parseReferral } from "@/lib/import/values";
import { isSamePersonName } from "@/lib/patients/new-patient";
import { normalizePhone } from "@/lib/phone";
import { containsResidentRegistrationNumber } from "@/lib/validation/forbidden-text";
import { sealBirthDate, sealPhone } from "@/server/crypto/pii";
import type { DbClient } from "@/server/db";
import { CHART_NO_MAX, MEMO_MAX, NAME_MAX, TAG_MAX, TAGS_MAX } from "@/server/patients/schema";
import { addError, emptyReport, type ImportReport, type ImportRow, patientMatcher, splitList } from "./shared";

/**
 * 고객 가져오기 — F-7(T9-1·T9-2 일부).
 * - 필수: 이름, 휴대폰. 번호는 정규화하고 암호화해 저장한다(T1-2).
 * - 이름+번호가 같은 고객(또는 같은 차트번호의 고객)이 이미 있으면 건너뛴다 → 같은 파일을 두 번 넣어도 중복이 없다.
 * - 기존 CRM의 고객이므로 구환(RETURNING)으로 넣는다(F-4).
 * - 메모에 주민등록번호 모양이 있으면 그 행은 넣지 않는다(절대 규칙 3).
 * - 시험 실행(dryRun)이면 아무것도 쓰지 않고 보고서만 만든다.
 */
export async function importPatients(
  client: DbClient,
  rows: ImportRow[],
  options: { dryRun: boolean; firstRow: number; actorId: string },
): Promise<{ report: ImportReport; patientIds: string[] }> {
  const report = emptyReport(options.dryRun, rows.length);
  const match = await patientMatcher(client, rows);
  const takenCharts = new Set(
    (
      await client.patient.findMany({
        where: { dentwebChartNo: { in: rows.map((r) => (r.chartNo ?? "").trim().toUpperCase()).filter(Boolean) } },
        select: { dentwebChartNo: true },
      })
    ).map((p) => p.dentwebChartNo!.toUpperCase()),
  );
  const seenInFile = new Set<string>();
  const patientIds: string[] = [];

  for (const [index, row] of rows.entries()) {
    const rowNo = options.firstRow + index;
    const name = (row.name ?? "").trim();
    const phone = normalizePhone(row.phone ?? "");
    if (!name) { addError(report, rowNo, "NAME_MISSING"); continue; }
    if (name.length > NAME_MAX) { addError(report, rowNo, "NAME_TOO_LONG"); continue; }
    if (!phone) { addError(report, rowNo, "PHONE_INVALID"); continue; }

    // 같은 사람: 이름+번호가 같거나, 차트번호와 이름이 같다. 차트번호만 같고 이름이 다르면 아래에서 CHART_NO_TAKEN.
    const byChart = row.chartNo?.trim() ? match(row) : null;
    const existing = match({ ...row, chartNo: "" }) ?? (byChart && isSamePersonName(byChart.name, name) ? byChart : null);
    if (existing) { report.existing += 1; patientIds.push(existing.id); continue; }
    const fileKey = `${name.replace(/\s+/g, "").toLowerCase()}|${phone}`;
    if (seenInFile.has(fileKey)) { report.existing += 1; continue; }

    const birthText = (row.birthDate ?? "").trim();
    const birthDate = birthText ? parseDateKey(birthText) : null;
    if (birthText && !birthDate) { addError(report, rowNo, "BIRTH_DATE_INVALID"); continue; }
    const chartNo = (row.chartNo ?? "").trim().toUpperCase() || null;
    if (chartNo && chartNo.length > CHART_NO_MAX) { addError(report, rowNo, "CHART_NO_TOO_LONG"); continue; }
    if (chartNo && takenCharts.has(chartNo)) { addError(report, rowNo, "CHART_NO_TAKEN"); continue; }
    const memo = (row.memo ?? "").trim().slice(0, MEMO_MAX) || null;
    if (memo && containsResidentRegistrationNumber(memo)) { addError(report, rowNo, "RRN_IN_MEMO"); continue; }

    seenInFile.add(fileKey);
    if (chartNo) takenCharts.add(chartNo);
    report.created += 1;
    if (options.dryRun) continue;
    const created = await client.patient.create({
      data: {
        name,
        ...sealPhone(phone),
        birthDateEnc: birthDate ? sealBirthDate(birthDate) : null,
        gender: parseGender(row.gender ?? ""),
        visitType: "RETURNING",
        referralSource: parseReferral(row.referral ?? ""),
        tags: splitList(row.tags, TAGS_MAX, TAG_MAX),
        dentwebChartNo: chartNo,
        memo,
        createdById: options.actorId,
      },
      select: { id: true },
    });
    patientIds.push(created.id);
  }
  return { report, patientIds };
}
