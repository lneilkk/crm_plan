import "server-only";

import { SLOT_HOLDING_STATUSES } from "@/lib/domain/appointment";
import type { BusinessHours, Chair } from "@/lib/domain/clinic";
import { kstDateKey, kstDayStart } from "@/lib/time/kst";
import { ApiError } from "@/server/api/errors";
import type { DbClient } from "@/server/db";

/**
 * 병원 설정 저장 — F-14(Task.md T4-4): 체어·열 묶음, 진료시간, 지각 허용·노쇼 유예 시간. 관리자만(route의 settings.write).
 * 체어 코드는 예약에 저장되므로 한 번 쓰면 바꾸지 않는다(이름·묶음·순서는 바꿀 수 있다).
 * 오늘 이후에 자리를 차지한 예약이 있는 체어는 목록에서 뺄 수 없다.
 */

export async function saveChairs(client: DbClient, chairs: Chair[], actorId: string, now: Date): Promise<{ removed: number }> {
  const codes = chairs.map((c) => c.code);
  if (new Set(codes).size !== codes.length) throw new ApiError(400, "DUPLICATE_CHAIR_CODE", "같은 체어 코드가 두 번 있습니다.");
  if (!chairs.some((c) => c.kind === "CHAIR")) throw new ApiError(400, "NO_TREATMENT_CHAIR", "진료 체어가 하나 이상 있어야 합니다.");
  const current = await client.clinicSetting.findUnique({ where: { id: 1 }, select: { chairs: true } });
  if (!current) throw new ApiError(500, "SETTINGS_MISSING", "병원 설정이 없습니다. npm run db:seed");
  const removed = (current.chairs as Chair[]).map((c) => c.code).filter((code) => !codes.includes(code));
  if (removed.length > 0) {
    const inUse = await client.appointment.count({
      where: {
        chair: { in: removed },
        startAt: { gte: kstDayStart(kstDateKey(now)) },
        status: { in: [...SLOT_HOLDING_STATUSES] },
      },
    });
    if (inUse > 0) throw new ApiError(409, "CHAIR_IN_USE", "오늘 이후 예약이 있는 체어는 뺄 수 없습니다. 예약을 먼저 옮기세요.");
  }
  const cleaned = chairs.map((c) => ({ code: c.code, name: c.name.trim(), kind: c.kind, ...(c.group?.trim() ? { group: c.group.trim() } : {}) }));
  await client.clinicSetting.update({ where: { id: 1 }, data: { chairs: cleaned, updatedById: actorId } });
  return { removed: removed.length };
}

export async function saveClinicRules(
  client: DbClient,
  input: { lateToleranceMin: number; noShowGraceMin: number; businessHours: BusinessHours },
  actorId: string,
): Promise<void> {
  for (const hours of Object.values(input.businessHours)) {
    if (hours && hours.open >= hours.close) throw new ApiError(400, "INVALID_HOURS", "진료 시작 시각이 끝 시각보다 빨라야 합니다.");
  }
  const updated = await client.clinicSetting.updateMany({ where: { id: 1 }, data: { ...input, updatedById: actorId } });
  if (updated.count !== 1) throw new ApiError(500, "SETTINGS_MISSING", "병원 설정이 없습니다. npm run db:seed");
}
