import "server-only";

import { type AppointmentChannel, type AppointmentStatus, ARRIVED_STATUSES, SLOT_HOLDING_STATUSES } from "@/lib/domain/appointment";
import { treatmentMetaOf } from "@/lib/domain/treatment";
import { parseDateKey, parseStatus, parseTime } from "@/lib/import/values";
import { kstDateTime } from "@/lib/time/kst";
import { containsResidentRegistrationNumber } from "@/lib/validation/forbidden-text";
import { getClinicSettings } from "@/server/appointments/settings";
import type { DbClient } from "@/server/db";
import { addError, bump, emptyReport, type ImportReport, type ImportRow, patientMatcher, staffByName } from "./shared";

/**
 * 예약·내원 이력 가져오기 — F-7(T9-1 일부).
 * - 고객은 먼저 가져와 있어야 한다(차트번호 또는 이름+휴대폰으로 찾는다). 못 찾으면 오류.
 * - 같은 고객·같은 시각의 예약이 이미 있으면 건너뛴다(같은 파일을 두 번 넣어도 중복 없음).
 * - 상태와 상태 이력(visit_status_log)을 한 트랜잭션에 함께 쓴다: null → 예약확정, 예약확정 → 파일의 상태.
 *   이력의 입력 기기는 "import", 입력자는 가져오는 관리자, 기록 시각은 가져온 시각. 노쇼·당일취소 사유는 '기타'.
 * - 체어: 파일의 체어가 병원 설정의 체어(코드·이름)면 그 체어, 아니면(또는 그 시각에 이미 차 있으면) '이관1'…'이관30' 중
 *   비어 있는 자리. 기존 CRM에서는 겹쳐도 됐던 이력이 같은 체어·같은 시간 제약(T4-1)에 걸리지 않게 한다.
 * - 단가는 지금 설정의 항목 단가(F-6), 할인율 0.
 */

const IMPORT_CHAIRS = Array.from({ length: 30 }, (_, i) => `이관${i + 1}`);
const IMPORT_INPUT_DEVICE = "import";

function parseChannel(text: string): AppointmentChannel | null {
  const t = text.trim();
  if (!t) return null;
  if (/워크인|walk/i.test(t)) return "WALK_IN";
  if (/현장|방문|내원/.test(t)) return "ONSITE";
  if (/네이버|카카오|플랫폼|앱/.test(t)) return "PLATFORM";
  if (/홈페이지|웹|인터넷/.test(t)) return "WEBSITE";
  if (/전화/.test(t)) return "PHONE";
  return null;
}

export async function importAppointments(
  client: DbClient,
  rows: ImportRow[],
  options: { dryRun: boolean; firstRow: number; actorId: string; now: Date },
): Promise<{ report: ImportReport; patientIds: string[] }> {
  const report = emptyReport(options.dryRun, rows.length);
  const settings = await getClinicSettings(client);
  const match = await patientMatcher(client, rows);
  const doctorOf = await staffByName(client, ["DOCTOR", "ADMIN"]);
  const chairOf = (text: string) => {
    const t = text.trim();
    return settings.chairs.find((c) => c.code === t || c.name === t)?.code ?? null;
  };

  type Parsed = { rowNo: number; patientId: string; startAt: Date; endAt: Date; durationMin: number; status: AppointmentStatus; row: ImportRow };
  const parsed: Parsed[] = [];
  for (const [index, row] of rows.entries()) {
    const rowNo = options.firstRow + index;
    const patient = match(row);
    if (!patient) { addError(report, rowNo, "PATIENT_NOT_FOUND"); continue; }
    const date = parseDateKey(row.date ?? "");
    if (!date) { addError(report, rowNo, "DATE_INVALID"); continue; }
    const timeText = (row.time ?? "").trim() || ((row.date ?? "").includes(":") ? row.date : "");
    const time = timeText ? parseTime(timeText) : "09:00";
    if (!time) { addError(report, rowNo, "TIME_INVALID"); continue; }
    if (!timeText) bump(report.notes, "TIME_DEFAULTED");
    const durationText = (row.duration ?? "").trim();
    let durationMin = durationText ? Math.round(Number(durationText) / 5) * 5 : 30;
    if (!Number.isFinite(durationMin) || durationMin < 5) { addError(report, rowNo, "DURATION_INVALID"); continue; }
    durationMin = Math.min(480, durationMin);
    const status = parseStatus(row.status ?? "");
    if (!status) { addError(report, rowNo, "STATUS_UNKNOWN"); continue; }
    const memo = (row.memo ?? "").trim();
    if (memo && containsResidentRegistrationNumber(memo)) { addError(report, rowNo, "RRN_IN_MEMO"); continue; }
    const startAt = kstDateTime(date, time);
    parsed.push({ rowNo, patientId: patient.id, startAt, endAt: new Date(startAt.getTime() + durationMin * 60_000), durationMin, status, row });
  }
  if (parsed.length === 0) return { report, patientIds: [] };

  // 이미 있는 예약(같은 고객·같은 시각) — 건너뛴다
  const minStart = new Date(Math.min(...parsed.map((p) => p.startAt.getTime())) - 8 * 3_600_000);
  const maxEnd = new Date(Math.max(...parsed.map((p) => p.endAt.getTime())));
  const existing = await client.appointment.findMany({
    where: { startAt: { gte: minStart, lt: maxEnd } },
    select: { patientId: true, startAt: true, endAt: true, chair: true, status: true },
  });
  const existingKeys = new Set(existing.map((a) => `${a.patientId}|${a.startAt.getTime()}`));
  // 자리를 차지한 구간(체어별) — 지금 DB + 이번에 넣을 것
  const busy = new Map<string, { start: number; end: number }[]>();
  const hold = (chair: string, start: number, end: number) => busy.set(chair, [...(busy.get(chair) ?? []), { start, end }]);
  for (const a of existing) {
    if ((SLOT_HOLDING_STATUSES as readonly string[]).includes(a.status)) hold(a.chair, a.startAt.getTime(), a.endAt.getTime());
  }
  const isFree = (chair: string, start: number, end: number) => !(busy.get(chair) ?? []).some((b) => b.start < end && start < b.end);

  const patientIds = new Set<string>();
  for (const p of parsed) {
    const key = `${p.patientId}|${p.startAt.getTime()}`;
    if (existingKeys.has(key)) { report.existing += 1; patientIds.add(p.patientId); continue; }
    existingKeys.add(key);

    const start = p.startAt.getTime();
    const end = p.endAt.getTime();
    const holdsSlot = (SLOT_HOLDING_STATUSES as readonly string[]).includes(p.status);
    const wanted = chairOf(p.row.chair ?? "");
    let chair = wanted;
    if (holdsSlot && (!chair || !isFree(chair, start, end))) {
      chair = IMPORT_CHAIRS.find((c) => isFree(c, start, end)) ?? null;
      if (!chair) { addError(report, p.rowNo, "NO_FREE_IMPORT_CHAIR"); continue; }
    }
    chair ??= IMPORT_CHAIRS[0];
    if (wanted !== chair) bump(report.notes, "CHAIR_IMPORT");
    if (holdsSlot) hold(chair, start, end);

    const doctorText = (p.row.doctor ?? "").trim();
    const doctorId = doctorOf(doctorText);
    if (doctorText && !doctorId) bump(report.notes, "DOCTOR_NOT_FOUND");
    const channel = parseChannel(p.row.channel ?? "");
    if (!channel) bump(report.notes, "CHANNEL_DEFAULTED");
    const item = (p.row.item ?? "").trim().slice(0, 50) || "기타";

    report.created += 1;
    patientIds.add(p.patientId);
    if (options.dryRun) continue;

    const created = await client.appointment.create({
      data: {
        patientId: p.patientId,
        startAt: p.startAt,
        durationMin: p.durationMin,
        endAt: p.endAt,
        doctorId,
        chair,
        treatmentItem: item,
        channel: channel ?? "PHONE",
        status: p.status,
        arrivedAt: (ARRIVED_STATUSES as readonly string[]).includes(p.status) ? p.startAt : null,
        memo: (p.row.memo ?? "").trim().slice(0, 1000) || null,
        listPrice: treatmentMetaOf(settings.treatmentItemMeta, item).price,
        createdById: options.actorId,
      },
      select: { id: true },
    });
    await client.visitStatusLog.create({
      data: {
        appointmentId: created.id,
        fromStatus: null,
        toStatus: "BOOKED",
        staffId: options.actorId,
        inputDevice: IMPORT_INPUT_DEVICE,
        createdAt: options.now,
      },
    });
    if (p.status !== "BOOKED") {
      await client.visitStatusLog.create({
        data: {
          appointmentId: created.id,
          fromStatus: "BOOKED",
          toStatus: p.status,
          reasonCode: p.status === "NO_SHOW" || p.status === "CANCELED_SAME_DAY" ? "OTHER" : null,
          staffId: options.actorId,
          inputDevice: IMPORT_INPUT_DEVICE,
          // 같은 예약의 이력은 기록 시각으로 순서를 정한다(마지막 이력 = 현재 상태) — 1ms 뒤로 둔다.
          createdAt: new Date(options.now.getTime() + 1),
        },
      });
    }
    if (p.status === "NO_SHOW") {
      await client.patient.update({ where: { id: p.patientId }, data: { noShowCount: { increment: 1 } } });
    }
  }
  return { report, patientIds: [...patientIds] };
}
