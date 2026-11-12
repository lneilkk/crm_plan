import "server-only";

import type { TreatmentCategory, TreatmentItemMeta } from "@/lib/domain/treatment";
import { ApiError } from "@/server/api/errors";
import type { DbClient } from "@/server/db";

/** 예약 항목 목록·구분·단가 저장 (F-5·F-6). 화면 순서 그대로 저장한다. */
export async function saveTreatmentItems(
  client: DbClient,
  items: { name: string; category: TreatmentCategory; price: number; color?: string }[],
  actorId: string,
): Promise<{ treatmentItems: string[]; treatmentItemMeta: TreatmentItemMeta }> {
  const names = items.map((item) => item.name.trim());
  if (new Set(names).size !== names.length) throw new ApiError(400, "DUPLICATE_ITEM_NAME", "같은 이름의 예약 항목이 있습니다.");
  const treatmentItemMeta: TreatmentItemMeta = Object.fromEntries(
    items.map((item) => [
      item.name.trim(),
      { category: item.category, price: item.price, ...(item.color ? { color: item.color.toUpperCase() } : {}) },
    ]),
  );
  const updated = await client.clinicSetting.updateMany({
    where: { id: 1 },
    data: { treatmentItems: names, treatmentItemMeta, updatedById: actorId },
  });
  if (updated.count !== 1) throw new ApiError(500, "SETTINGS_MISSING", "병원 설정이 없습니다. npm run db:seed");
  return { treatmentItems: names, treatmentItemMeta };
}
