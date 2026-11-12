import "server-only";

import { Prisma } from "@/generated/prisma/client";
import {
  type CalendarLabel,
  MAX_LABELS,
  MAX_LABELS_PER_APPOINTMENT,
  resolveStatusStyles,
  type StatusStyles,
} from "@/lib/calendar/colors";
import { ApiError } from "@/server/api/errors";
import { db, type DbClient } from "@/server/db";

/**
 * 예약 색 라벨과 상태 표시 — F-2.
 * - 목록·상태 표시는 누구나 읽고(캘린더 범례·칸 색), 편집은 관리자만(route의 settings.write).
 * - 라벨을 지우는 것은 아무 예약에도 붙지 않았을 때만. 붙은 라벨은 숨김(is_active=false)으로만 뺀다.
 * - client는 route의 ctx.db(감사 행과 같은 트랜잭션)다.
 */

export type CalendarStyle = { labels: CalendarLabel[]; statusStyles: StatusStyles };

export async function getCalendarStyle(client: DbClient = db): Promise<CalendarStyle> {
  const [labels, setting] = await Promise.all([
    client.appointmentLabel.findMany({
      select: { id: true, name: true, color: true, sortOrder: true, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    client.clinicSetting.findUnique({ where: { id: 1 }, select: { statusStyles: true } }),
  ]);
  return { labels, statusStyles: resolveStatusStyles(setting?.statusStyles ?? null) };
}

export type SaveCalendarStyleInput = {
  /** 화면의 순서 그대로(위가 먼저). id가 없으면 새 라벨 */
  labels: { id?: string; name: string; color: string; isActive: boolean }[];
  statusStyles: StatusStyles;
};

export async function saveCalendarStyle(
  client: DbClient,
  input: SaveCalendarStyleInput,
  actorId: string,
): Promise<{ created: number; updated: number; deleted: number }> {
  if (input.labels.length > MAX_LABELS) throw new ApiError(400, "TOO_MANY_LABELS", `라벨은 ${MAX_LABELS}개까지 만들 수 있습니다.`);
  const names = input.labels.map((label) => label.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) throw new ApiError(400, "DUPLICATE_LABEL_NAME", "같은 이름의 라벨이 있습니다.");

  const existing = await client.appointmentLabel.findMany({ select: { id: true } });
  const existingIds = new Set(existing.map((row) => row.id));
  const keptIds = new Set(input.labels.flatMap((label) => (label.id ? [label.id] : [])));
  for (const id of keptIds) {
    if (!existingIds.has(id)) throw new ApiError(400, "UNKNOWN_LABEL", "없는 라벨이 들어 있습니다. 화면을 새로 고친 뒤 다시 저장하세요.");
  }
  const removed = [...existingIds].filter((id) => !keptIds.has(id));
  if (removed.length > 0) {
    const inUse = await client.appointmentLabelLink.count({ where: { labelId: { in: removed } } });
    if (inUse > 0) {
      throw new ApiError(409, "LABEL_IN_USE", "예약에 붙어 있는 라벨은 지울 수 없습니다. 숨기기로 바꾸세요.");
    }
    await client.appointmentLabel.deleteMany({ where: { id: { in: removed } } });
  }

  // 이름 바꾸기·맞바꾸기가 고유 제약에 걸리지 않게, 남는 라벨의 이름을 먼저 임시 이름으로 바꾼다.
  const kept = input.labels.filter((label) => label.id);
  for (const [index, label] of kept.entries()) {
    await client.appointmentLabel.update({ where: { id: label.id }, data: { name: `\u0001${index}` } });
  }
  let created = 0;
  for (const [sortOrder, label] of input.labels.entries()) {
    const data = { name: label.name.trim(), color: label.color.toUpperCase(), sortOrder, isActive: label.isActive };
    if (label.id) {
      await client.appointmentLabel.update({ where: { id: label.id }, data });
    } else {
      await client.appointmentLabel.create({ data });
      created += 1;
    }
  }

  await client.clinicSetting.update({
    where: { id: 1 },
    data: { statusStyles: input.statusStyles as unknown as Prisma.InputJsonValue, updatedById: actorId },
  });
  return { created, updated: kept.length, deleted: removed.length };
}

/**
 * 예약에 붙은 라벨을 labelIds로 바꾼다. 새로 붙이는 라벨은 숨기지 않은 것만, 이미 붙은 숨긴 라벨은 그대로 둘 수 있다.
 * 예약의 환자 id를 돌려준다(감사 행용).
 */
export async function setAppointmentLabels(
  client: DbClient,
  appointmentId: string,
  labelIds: readonly string[],
): Promise<{ patientId: string; added: number; removed: number }> {
  const unique = [...new Set(labelIds)];
  if (unique.length > MAX_LABELS_PER_APPOINTMENT) {
    throw new ApiError(400, "TOO_MANY_LABELS", `라벨은 예약 하나에 ${MAX_LABELS_PER_APPOINTMENT}개까지 붙일 수 있습니다.`);
  }
  const appointment = await client.appointment.findUnique({
    where: { id: appointmentId },
    select: { patientId: true, labels: { select: { labelId: true } } },
  });
  if (!appointment) throw new ApiError(404, "NOT_FOUND", "예약을 찾을 수 없습니다.");

  const current = new Set(appointment.labels.map((link) => link.labelId));
  const toAdd = unique.filter((id) => !current.has(id));
  const toRemove = [...current].filter((id) => !unique.includes(id));
  if (toAdd.length > 0) {
    const usable = await client.appointmentLabel.count({ where: { id: { in: toAdd }, isActive: true } });
    if (usable !== toAdd.length) throw new ApiError(400, "UNKNOWN_LABEL", "고를 수 없는 라벨이 들어 있습니다. 화면을 새로 고친 뒤 다시 고르세요.");
    await client.appointmentLabelLink.createMany({ data: toAdd.map((labelId) => ({ appointmentId, labelId })) });
  }
  if (toRemove.length > 0) {
    await client.appointmentLabelLink.deleteMany({ where: { appointmentId, labelId: { in: toRemove } } });
  }
  return { patientId: appointment.patientId, added: toAdd.length, removed: toRemove.length };
}
