import "server-only";

import type { Permission } from "@/lib/auth/permissions";
import type { TreatmentItemMeta, TreatmentMeta } from "@/lib/domain/treatment";
import { ApiError } from "@/server/api/errors";

/**
 * 예약 금액(단가·할인율·금액) 보기·고치기 — 확장 계획 S-3, appointment.price 권한.
 * 권한이 없으면 화면만이 아니라 API 응답에서 금액 항목을 뺀다(항목 자체를 지운다, 0이나 null로 바꾸지 않음).
 * 금액을 담는 응답은 이 파일의 함수를 거친다. tests/integration/price-visibility.test.ts가 모든 조회 API를 검사한다.
 */
export const PRICE_PERMISSION = "appointment.price" satisfies Permission;

type Viewer = { permissions: readonly Permission[] };

export function canSeePrice(viewer: Viewer): boolean {
  return viewer.permissions.includes(PRICE_PERMISSION);
}

/** 금액을 바꾸려는 요청(할인율·단가를 보냄)인데 권한이 없으면 403 */
export function assertCanChangePrice(viewer: Viewer): void {
  if (!canSeePrice(viewer)) throw new ApiError(403, "PRICE_FORBIDDEN", "금액(단가·할인율)을 바꿀 권한이 없습니다.");
}

/** 예약 한 건에서 금액 항목(listPrice, discountRate)을 뺀다 — 권한이 있으면 그대로 */
export function appointmentForViewer<T extends object>(viewer: Viewer, appointment: T): T | Omit<T, "listPrice" | "discountRate"> {
  if (canSeePrice(viewer)) return appointment;
  return omit(appointment, ["listPrice", "discountRate"]);
}

/** 객체에서 키를 지운 얕은 복사본 (항목 자체를 없앤다) */
export function omit<T extends object, K extends string>(value: T, keys: readonly K[]): Omit<T, K> {
  const copy = { ...value } as Record<string, unknown>;
  for (const key of keys) delete copy[key];
  return copy as Omit<T, K>;
}

/** 예약 항목 설정에서 단가를 뺀다 — 구분(고가·일반)과 색은 남긴다 */
export function treatmentMetaForViewer(viewer: Viewer, meta: TreatmentItemMeta): TreatmentItemMeta | Record<string, Omit<TreatmentMeta, "price">> {
  if (canSeePrice(viewer)) return meta;
  return Object.fromEntries(Object.entries(meta).map(([name, item]) => [name, omit(item, ["price"])]));
}
