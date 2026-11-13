import "server-only";

import type { TreatmentCategory, TreatmentItemMeta } from "@/lib/domain/treatment";
import { ApiError } from "@/server/api/errors";
import type { DbClient } from "@/server/db";

/** 예약 항목 목록·구분·단가 저장 (F-5·F-6). 화면 순서 그대로 저장한다. */
export async function saveTreatmentItems(
  client: DbClient,
  /** price를 빼면 같은 이름 항목의 기존 단가를 유지하고, 새 항목은 0원 (금액 권한이 없는 편집자, S-3) */
  items: { name: string; category: TreatmentCategory; price?: number; color?: string }[],
  actorId: string,
): Promise<{ treatmentItems: string[]; treatmentItemMeta: TreatmentItemMeta }> {
  const names = items.map((item) => item.name.trim());
  if (new Set(names).size !== names.length) throw new ApiError(400, "DUPLICATE_ITEM_NAME", "같은 이름의 예약 항목이 있습니다.");
  const current = await client.clinicSetting.findUnique({ where: { id: 1 }, select: { treatmentItemMeta: true } });
  const currentMeta = (current?.treatmentItemMeta ?? {}) as TreatmentItemMeta;
  const treatmentItemMeta: TreatmentItemMeta = Object.fromEntries(
    items.map((item) => [
      item.name.trim(),
      {
        category: item.category,
        price: item.price ?? currentMeta[item.name.trim()]?.price ?? 0,
        ...(item.color ? { color: item.color.toUpperCase() } : {}),
      },
    ]),
  );
  const updated = await client.clinicSetting.updateMany({
    where: { id: 1 },
    data: { treatmentItems: names, treatmentItemMeta, updatedById: actorId },
  });
  if (updated.count !== 1) throw new ApiError(500, "SETTINGS_MISSING", "병원 설정이 없습니다. npm run db:seed");
  return { treatmentItems: names, treatmentItemMeta };
}
