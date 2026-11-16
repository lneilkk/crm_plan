import "server-only";

import { ApiError } from "@/server/api/errors";
import type { DbClient } from "@/server/db";

/**
 * 수술 기록 — F-11. 참여 직원(예약을 보는 직원 누구나 봄)과 수술 메모(원장·관리자만, 조회마다 감사 로그).
 * client는 route의 ctx.db(감사 행과 같은 트랜잭션)다.
 */

async function patientOf(client: DbClient, appointmentId: string): Promise<string> {
  const row = await client.appointment.findUnique({ where: { id: appointmentId }, select: { patientId: true } });
  if (!row) throw new ApiError(404, "NOT_FOUND", "예약을 찾을 수 없습니다.");
  return row.patientId;
}

export async function setParticipants(client: DbClient, appointmentId: string, staffIds: readonly string[]) {
  const patientId = await patientOf(client, appointmentId);
  const unique = [...new Set(staffIds)];
  if (unique.length > 0) {
    const found = await client.staff.count({ where: { id: { in: unique }, isActive: true } });
    if (found !== unique.length) throw new ApiError(400, "UNKNOWN_STAFF", "고를 수 없는 직원이 있습니다. 화면을 새로 고치세요.");
  }
  await client.appointmentParticipant.deleteMany({ where: { appointmentId, staffId: { notIn: unique } } });
  await client.appointmentParticipant.createMany({ data: unique.map((staffId) => ({ appointmentId, staffId })), skipDuplicates: true });
  return { patientId, count: unique.length };
}

export async function getSurgeryNote(client: DbClient, appointmentId: string) {
  const patientId = await patientOf(client, appointmentId);
  const note = await client.surgeryNote.findUnique({
    where: { appointmentId },
    select: { content: true, updatedAt: true, updatedBy: { select: { name: true } } },
  });
  return { patientId, note: note ? { content: note.content, updatedAt: note.updatedAt.toISOString(), updatedByName: note.updatedBy.name } : null };
}

/** 빈 내용이면 메모를 지운다 */
export async function saveSurgeryNote(client: DbClient, appointmentId: string, content: string, actorId: string) {
  const patientId = await patientOf(client, appointmentId);
  if (!content) {
    await client.surgeryNote.deleteMany({ where: { appointmentId } });
    return { patientId, cleared: true };
  }
  await client.surgeryNote.upsert({
    where: { appointmentId },
    create: { appointmentId, content, updatedById: actorId },
    update: { content, updatedById: actorId },
  });
  return { patientId, cleared: false };
}
