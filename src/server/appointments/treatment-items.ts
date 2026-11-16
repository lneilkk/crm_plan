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
  /** 단가 없이 잡힌 예약에 채워 넣는 것을 사용자가 확인했다(건수를 본 뒤) */
  confirmBackfill = false,
): Promise<{ treatmentItems: string[]; treatmentItemMeta: TreatmentItemMeta; backfilled: { item: string; count: number }[] }> {
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
  // 빠진 단가를 채우면 그 항목으로 단가 없이(미입력) 잡힌 예약에도 들어간다 — 지난 실적이 바뀌는 유일한 경로라
  // 먼저 건수를 알리고 확인을 받는다(확인 없으면 409, 아무것도 바꾸지 않음). 이미 단가가 있는 예약은 예약 당시 단가 그대로다.
  const pending: { item: string; count: number }[] = [];
  for (const [name, meta] of Object.entries(treatmentItemMeta)) {
    if (meta.price === null) continue;
    const count = await client.appointment.count({ where: { treatmentItem: name, listPrice: null } });
    if (count > 0) pending.push({ item: name, count });
  }
  const total = pending.reduce((sum, p) => sum + p.count, 0);
  if (total > 0 && !confirmBackfill) {
    throw new ApiError(409, "BACKFILL_CONFIRM_REQUIRED", `단가 없이 잡힌 예약 ${total}건에도 이 단가가 적용됩니다. 확인 후 다시 저장하세요.`, {
      total,
      items: pending,
    });
  }
  const updated = await client.clinicSetting.updateMany({
    where: { id: 1 },
    data: { treatmentItems: names, treatmentItemMeta, updatedById: actorId },
  });
  if (updated.count !== 1) throw new ApiError(500, "SETTINGS_MISSING", "병원 설정이 없습니다. npm run db:seed");
  const backfilled: { item: string; count: number }[] = [];
  for (const { item } of pending) {
    const price = treatmentItemMeta[item].price;
    if (price === null) continue;
    const filled = await client.appointment.updateMany({ where: { treatmentItem: item, listPrice: null }, data: { listPrice: price } });
    if (filled.count > 0) backfilled.push({ item, count: filled.count });
  }
  return { treatmentItems: names, treatmentItemMeta, backfilled };
}
