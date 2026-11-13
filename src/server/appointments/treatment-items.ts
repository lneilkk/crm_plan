import "server-only";

import type { TreatmentCategory, TreatmentItemMeta } from "@/lib/domain/treatment";
import { ApiError } from "@/server/api/errors";
import type { DbClient } from "@/server/db";

/** 예약 항목 목록·구분·단가 저장 (F-5·F-6). 화면 순서 그대로 저장한다. */
export async function saveTreatmentItems(
  client: DbClient,
  /** price를 빼면 같은 이름 항목의 기존 단가를 유지하고, 새 항목은 단가 미입력(null) (금액 권한이 없는 편집자, S-3) */
  items: { name: string; category: TreatmentCategory; price?: number | null; color?: string }[],
  actorId: string,
): Promise<{ treatmentItems: string[]; treatmentItemMeta: TreatmentItemMeta; backfilled: number }> {
  const names = items.map((item) => item.name.trim());
  if (new Set(names).size !== names.length) throw new ApiError(400, "DUPLICATE_ITEM_NAME", "같은 이름의 예약 항목이 있습니다.");
  const current = await client.clinicSetting.findUnique({ where: { id: 1 }, select: { treatmentItemMeta: true } });
  const currentMeta = (current?.treatmentItemMeta ?? {}) as TreatmentItemMeta;
  const treatmentItemMeta: TreatmentItemMeta = Object.fromEntries(
    items.map((item) => [
      item.name.trim(),
      {
        category: item.category,
        price: item.price !== undefined ? item.price : (currentMeta[item.name.trim()]?.price ?? null),
        ...(item.color ? { color: item.color.toUpperCase() } : {}),
      },
    ]),
  );
  const updated = await client.clinicSetting.updateMany({
    where: { id: 1 },
    data: { treatmentItems: names, treatmentItemMeta, updatedById: actorId },
  });
  if (updated.count !== 1) throw new ApiError(500, "SETTINGS_MISSING", "병원 설정이 없습니다. npm run db:seed");
  // 빠진 단가를 채우면, 그 항목으로 단가 없이(미입력) 잡힌 예약에도 채운다. 이미 단가가 있는 예약은 그대로다(예약 당시 단가).
  let backfilled = 0;
  for (const [name, meta] of Object.entries(treatmentItemMeta)) {
    if (meta.price === null) continue;
    const filled = await client.appointment.updateMany({ where: { treatmentItem: name, listPrice: null }, data: { listPrice: meta.price } });
    backfilled += filled.count;
  }
  return { treatmentItems: names, treatmentItemMeta, backfilled };
}
