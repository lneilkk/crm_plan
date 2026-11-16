"use client";

import { useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/auth/api-client";
import { guessMapping, IMPORT_CHUNK_ROWS, IMPORT_FIELDS, IMPORT_KIND_LABEL, IMPORT_KINDS, type ImportKind } from "@/lib/import/fields";
import { cellToText, isResidentNumberHeader } from "@/lib/import/values";
import { Button, Card, CardTitle, FieldError, Label, Select, Spinner, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";

type Report = {
  dryRun: boolean;
  total: number;
  created: number;
  existing: number;
  skipped: Record<string, number>;
  notes: Record<string, number>;
  errors: { row: number; code: string }[];
};

type Sheet = { name: string; headers: string[]; rows: string[][] };

const ERROR_MESSAGE: Record<string, string> = {
  NAME_MISSING: "이름이 없습니다",
  NAME_TOO_LONG: "이름이 너무 깁니다",
  PHONE_INVALID: "휴대폰 번호 형식이 맞지 않습니다",
  BIRTH_DATE_INVALID: "생년월일을 알아볼 수 없습니다",
  CHART_NO_TOO_LONG: "차트번호가 너무 깁니다",
  CHART_NO_TAKEN: "다른 고객이 쓰는 차트번호입니다",
  RRN_IN_MEMO: "메모에 주민등록번호 모양이 있어 넣지 않았습니다",
  RRN_IN_CONTENT: "상담 내용에 주민등록번호 모양이 있어 넣지 않았습니다",
  PATIENT_NOT_FOUND: "고객을 찾지 못했습니다(고객 기본 정보를 먼저 가져오세요)",
  DATE_INVALID: "날짜를 알아볼 수 없습니다",
  TIME_INVALID: "시각을 알아볼 수 없습니다",
  DURATION_INVALID: "소요시간을 알아볼 수 없습니다",
  STATUS_UNKNOWN: "상태를 알아볼 수 없습니다",
  NO_FREE_IMPORT_CHAIR: "같은 시각 예약이 너무 많아 자리를 찾지 못했습니다",
  CONTENT_MISSING: "상담 내용이 없습니다",
};

const NOTE_MESSAGE: Record<string, string> = {
  TIME_DEFAULTED: "시각이 없어 09:00으로 넣음",
  CHAIR_IMPORT: "체어를 찾지 못해(또는 겹쳐서) '이관' 자리에 넣음",
  DOCTOR_NOT_FOUND: "의사 이름이 직원과 맞지 않아 미지정으로 넣음",
  CHANNEL_DEFAULTED: "예약 경로가 없어 '전화'로 넣음",
  COUNSELOR_FALLBACK: "상담자 이름이 직원과 맞지 않아 가져온 관리자로 넣음",
  CONSENT_RECORDED: "민감정보 동의 기록을 새로 남김",
};

/**
 * 기존 CRM 엑셀 가져오기 (F-7, 관리자). 엑셀은 이 브라우저에서 읽고, 고른 열만 서버로 보낸다(주민번호 열은 보내지 않음).
 * 시험 실행으로 결과를 본 뒤 가져온다. 같은 파일을 다시 가져와도 중복이 생기지 않는다.
 */
export function ImportScreen() {
  const [confirmed, setConfirmed] = useState(false);
  const [kind, setKind] = useState<ImportKind>("patients");
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [running, setRunning] = useState<{ dryRun: boolean; done: number; total: number } | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  /** 시험 실행을 마친 설정(종류·시트·매핑) — 이것과 같을 때만 [가져오기]를 누를 수 있다 */
  const [testedKey, setTestedKey] = useState<string | null>(null);

  const sheet = sheets?.[sheetIndex] ?? null;
  const fields = IMPORT_FIELDS[kind];
  const settingKey = JSON.stringify({ kind, sheetIndex, mapping, rows: sheet?.rows.length });
  const missing = fields.filter((f) => f.required && (mapping[f.key] ?? null) === null).map((f) => f.label);
  const identityMissing = kind !== "patients" && mapping.chartNo == null && (mapping.phone == null || mapping.name == null);
  const rrnColumns = sheet?.headers.filter(isResidentNumberHeader) ?? [];

  function chooseKind(next: ImportKind) {
    setKind(next);
    setReport(null);
    setTestedKey(null);
    if (sheet) setMapping(guessMapping(next, sheet.headers));
  }

  async function readFile(file: File) {
    setReading(true);
    setFileError(null);
    setReport(null);
    setTestedKey(null);
    try {
      const { default: readExcelFile } = await import("read-excel-file/browser");
      const all = await readExcelFile(file);
      const parsed = all
        .map((s) => {
          const [head = [], ...body] = s.data;
          return {
            name: s.sheet,
            headers: head.map((cell) => cellToText(cell)),
            rows: body.map((row) => row.map((cell) => cellToText(cell))).filter((row) => row.some((v) => v !== "")),
          };
        })
        .filter((s) => s.headers.length > 0);
      if (parsed.length === 0) throw new Error("empty");
      setSheets(parsed);
      setSheetIndex(0);
      setMapping(guessMapping(kind, parsed[0].headers));
    } catch {
      setSheets(null);
      setFileError("엑셀(.xlsx) 파일을 읽지 못했습니다. 첫 줄에 열 이름이 있는 .xlsx 파일인지 확인하세요(.xls는 .xlsx로 다시 저장).");
    } finally {
      setReading(false);
    }
  }

  async function run(dryRun: boolean) {
    if (!sheet) return;
    setRunError(null);
    setReport(null);
    const rows = sheet.rows.map((cells) => {
      const row: Record<string, string> = {};
      for (const field of fields) {
        const index = mapping[field.key];
        if (index !== null && index !== undefined) row[field.key] = cells[index] ?? "";
      }
      return row;
    });
    const total: Report = { dryRun, total: 0, created: 0, existing: 0, skipped: {}, notes: {}, errors: [] };
    setRunning({ dryRun, done: 0, total: rows.length });
    try {
      for (let start = 0; start < rows.length; start += IMPORT_CHUNK_ROWS) {
        const chunk = rows.slice(start, start + IMPORT_CHUNK_ROWS);
        const part = await apiFetch<Report>(`/api/import/${kind}`, {
          method: "POST",
          body: { dryRun, firstRow: start + 2, rows: chunk },
        });
        total.total += part.total;
        total.created += part.created;
        total.existing += part.existing;
        for (const [k, v] of Object.entries(part.skipped)) total.skipped[k] = (total.skipped[k] ?? 0) + v;
        for (const [k, v] of Object.entries(part.notes)) total.notes[k] = (total.notes[k] ?? 0) + v;
        total.errors.push(...part.errors);
        setRunning({ dryRun, done: Math.min(rows.length, start + chunk.length), total: rows.length });
      }
      setReport(total);
      if (dryRun) setTestedKey(settingKey);
    } catch (error) {
      setRunError(error instanceof ApiRequestError ? error.message : "가져오지 못했습니다. 다시 시도하세요.");
      setReport(total.total > 0 ? total : null);
    } finally {
      setRunning(null);
    }
  }

  const errorCount = report ? Object.entries(report.skipped).filter(([k]) => k.startsWith("error:")).reduce((n, [, v]) => n + v, 0) : 0;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <h1 className="text-2xl font-bold text-slate-900">기존 CRM 데이터 가져오기</h1>

      <div role="note" className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-900">
        <p className="font-bold">실제 고객 파일은 아직 올리지 마세요.</p>
        <p className="mt-1">
          실제 환자 정보는 보안 점검(R3)을 통과한 운영 서버에서만 넣습니다. 지금은 기능 확인용으로 가짜(시험) 파일만 씁니다. 주민등록번호 열은
          자동으로 빠지고 이 PC 밖으로 보내지 않습니다.
        </p>
        <label className="mt-3 flex min-h-11 items-center gap-2 font-semibold">
          <input type="checkbox" className="size-5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          가짜(시험) 파일만 쓴다는 것을 확인했습니다
        </label>
      </div>

      <Card className="flex flex-col gap-3">
        <CardTitle>1. 무엇을 가져올까요?</CardTitle>
        <div role="group" aria-label="가져올 종류" className="flex flex-wrap gap-2">
          {IMPORT_KINDS.map((k) => (
            <Button key={k} variant={kind === k ? "primary" : "secondary"} aria-pressed={kind === k} onClick={() => chooseKind(k)}>
              {IMPORT_KIND_LABEL[k]}
            </Button>
          ))}
        </div>
        <p className="text-sm text-slate-600">
          순서: 고객 기본 정보 → 예약·내원 이력 → 상담 기록. 예약·상담은 이미 가져온 고객(차트번호 또는 이름+휴대폰)에 연결됩니다. 상담 기록은
          민감정보 동의 칸이 Y·예·동의인 행만 가져옵니다.
        </p>
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle>2. 엑셀 파일</CardTitle>
        <div>
          <Label htmlFor="import-file">엑셀 파일(.xlsx, 첫 줄은 열 이름)</Label>
          <input
            id="import-file"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={!confirmed || reading || running !== null}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
            }}
            className="block text-base"
          />
          {!confirmed && <p className="mt-1 text-sm text-slate-500">위의 확인란을 먼저 체크하세요.</p>}
        </div>
        {reading && <Spinner showLabel label="파일을 읽는 중" />}
        {fileError && <FieldError>{fileError}</FieldError>}
        {sheets && sheets.length > 1 && (
          <div>
            <Label htmlFor="import-sheet">시트</Label>
            <Select
              id="import-sheet"
              className="w-auto"
              value={String(sheetIndex)}
              onChange={(e) => {
                const index = Number(e.target.value);
                setSheetIndex(index);
                setMapping(guessMapping(kind, sheets[index].headers));
                setTestedKey(null);
              }}
            >
              {sheets.map((s, i) => (
                <option key={s.name} value={i}>
                  {s.name} ({s.rows.length}행)
                </option>
              ))}
            </Select>
          </div>
        )}
        {sheet && <p className="text-base">데이터 {sheet.rows.length.toLocaleString("ko-KR")}행 (열 {sheet.headers.length}개)</p>}
        {rrnColumns.length > 0 && (
          <p className="rounded-lg bg-amber-50 p-2 text-amber-900">주민등록번호 열({rrnColumns.length}개)은 가져오지 않습니다.</p>
        )}
      </Card>

      {sheet && (
        <Card className="flex flex-col gap-3">
          <CardTitle>3. 열 맞추기</CardTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((field) => (
              <div key={field.key}>
                <Label htmlFor={`map-${field.key}`}>
                  {field.label}
                  {field.required && " *"}
                </Label>
                <Select
                  id={`map-${field.key}`}
                  value={mapping[field.key] == null ? "" : String(mapping[field.key])}
                  onChange={(e) => {
                    setMapping({ ...mapping, [field.key]: e.target.value === "" ? null : Number(e.target.value) });
                    setTestedKey(null);
                  }}
                >
                  <option value="">(가져오지 않음)</option>
                  {sheet.headers.map((header, i) =>
                    isResidentNumberHeader(header) ? null : (
                      <option key={`${header}-${i}`} value={i}>
                        {header || `(이름 없는 열 ${i + 1})`}
                      </option>
                    ),
                  )}
                </Select>
                {field.hint && <p className="mt-0.5 text-sm text-slate-500">{field.hint}</p>}
              </div>
            ))}
          </div>
          {missing.length > 0 && <FieldError>꼭 맞춰야 하는 항목: {missing.join(", ")}</FieldError>}
          {identityMissing && <FieldError>고객을 찾으려면 차트번호, 또는 이름과 휴대폰을 맞추세요.</FieldError>}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              size="lg"
              disabled={!confirmed || missing.length > 0 || identityMissing || running !== null}
              onClick={() => void run(true)}
            >
              4. 시험 실행 (저장하지 않음)
            </Button>
            <Button
              size="lg"
              disabled={!confirmed || testedKey !== settingKey || running !== null}
              onClick={() => void run(false)}
              title={testedKey !== settingKey ? "먼저 시험 실행으로 결과를 확인하세요" : undefined}
            >
              5. 가져오기
            </Button>
            {running && (
              <Spinner showLabel label={`${running.dryRun ? "시험 실행" : "가져오는"} 중 ${running.done}/${running.total}행`} />
            )}
          </div>
          {runError && <FieldError>{runError}</FieldError>}
        </Card>
      )}

      {report && (
        <Card className="flex flex-col gap-3" aria-label="가져오기 결과">
          <CardTitle>{report.dryRun ? "시험 실행 결과 (저장하지 않음)" : "가져오기 결과"}</CardTitle>
          <ul className="grid gap-1 text-base sm:grid-cols-2">
            <li>전체 {report.total.toLocaleString("ko-KR")}행</li>
            <li className="font-semibold text-green-800">{report.dryRun ? "넣을" : "넣은"} 행 {report.created.toLocaleString("ko-KR")}</li>
            <li>이미 있어서 건너뜀 {report.existing.toLocaleString("ko-KR")}</li>
            {report.skipped.CONSENT_MISSING ? <li>동의 미확인으로 건너뜀 {report.skipped.CONSENT_MISSING.toLocaleString("ko-KR")}</li> : null}
            <li className={errorCount > 0 ? "font-semibold text-red-700" : ""}>오류 {errorCount.toLocaleString("ko-KR")}</li>
          </ul>
          {Object.keys(report.notes).length > 0 && (
            <ul className="list-disc pl-5 text-sm text-slate-700">
              {Object.entries(report.notes).map(([code, count]) => (
                <li key={code}>
                  {NOTE_MESSAGE[code] ?? code}: {count.toLocaleString("ko-KR")}건
                </li>
              ))}
            </ul>
          )}
          {report.errors.length > 0 && (
            <Table aria-label="오류 행">
              <THead>
                <Tr>
                  <Th>엑셀 행</Th>
                  <Th>사유</Th>
                </Tr>
              </THead>
              <TBody>
                {report.errors.map((error) => (
                  <Tr key={`${error.row}-${error.code}`}>
                    <Td className="tabular-nums">{error.row}</Td>
                    <Td>{ERROR_MESSAGE[error.code] ?? error.code}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
