/**
 * 예약 항목의 구분과 단가 — F-5(상담실 열에는 고가 진료만), F-6(실적 금액).
 *
 * - 구분: PREMIUM(고가, 상담 대상 — 임플란트·라미네이트 등) / GENERAL(일반 — 스케일링 등).
 *   상담실(CONSULT_ROOM) 자리에는 고가 항목 예약만 둔다(서버가 등록·이동·수정에서 막는다).
 * - 단가: 원 단위 정수. 예약을 만들거나 항목을 바꿀 때 그 시점 단가를 예약에 저장한다(appointment.list_price) —
 *   나중에 단가를 바꿔도 지난 실적은 변하지 않는다.
 * - 금액 = 단가 × (100 − 할인율)%, 원 단위 반올림. 할인율은 예약마다 0~100 정수(%).
 * - 실제 진료비·수납액이 아니라 병원이 정한 기준 단가로 계산한 추정 금액이다(수납 연계는 2차 개발).
 * - 이름은 예약 분류이며 진료기록(진단·처방)이 아니다(절대 규칙 3).
 */

export const TREATMENT_CATEGORIES = ["PREMIUM", "GENERAL"] as const;
export type TreatmentCategory = (typeof TREATMENT_CATEGORIES)[number];

export const TREATMENT_CATEGORY_LABEL: Record<TreatmentCategory, string> = {
  PREMIUM: "고가(상담 대상)",
  GENERAL: "일반",
};

/**
 * price: 단가(원). null은 "단가 미입력"이다(금액 권한 없이 만든 항목 등, S-3) — 0원(무료)과 다르다.
 * color: 캘린더 칸 색(#RRGGBB, F-9). 없으면 기본 항목 색, 그것도 없으면 상태 색
 */
export type TreatmentMeta = { category: TreatmentCategory; price: number | null; color?: string };
/** 항목 이름 → 구분·단가 (clinic_setting.treatment_item_meta) */
export type TreatmentItemMeta = Record<string, TreatmentMeta>;

export const PRICE_MAX = 100_000_000;

/** 기본 구분·단가. 단가는 예시 값이다 — 관리자가 캘린더 [편집] 탭에서 병원 실제 단가로 바꾼다. */
export const DEFAULT_TREATMENT_ITEM_META: TreatmentItemMeta = {
  정기검진: { category: "GENERAL", price: 20_000, color: "#90CAF9" },
  스케일링: { category: "GENERAL", price: 15_000, color: "#80DEEA" },
  "충치 치료": { category: "GENERAL", price: 50_000, color: "#A5D6A7" },
  "신경 치료": { category: "GENERAL", price: 150_000, color: "#FFCC80" },
  발치: { category: "GENERAL", price: 50_000, color: "#BCAAA4" },
  미백: { category: "GENERAL", price: 300_000, color: "#F8BBD0" },
  임플란트: { category: "PREMIUM", price: 1_200_000, color: "#9575CD" },
  라미네이트: { category: "PREMIUM", price: 600_000, color: "#F06292" },
  교정: { category: "PREMIUM", price: 3_000_000, color: "#4DB6AC" },
  보철: { category: "PREMIUM", price: 500_000, color: "#A1887F" },
  상담: { category: "PREMIUM", price: 0, color: "#FFD54F" },
};

export function treatmentMetaOf(meta: TreatmentItemMeta, item: string): TreatmentMeta {
  // 설정에 없는 항목은 단가를 모른다(미입력)
  return Object.hasOwn(meta, item) ? meta[item] : { category: "GENERAL", price: null };
}

/** 항목의 칸 색: 설정의 색 → 기본 항목 색 → null(상태 색을 쓴다) */
export function treatmentColorOf(meta: TreatmentItemMeta, item: string): string | null {
  const stored = Object.hasOwn(meta, item) ? meta[item].color : undefined;
  if (stored && /^#[0-9A-Fa-f]{6}$/.test(stored)) return stored.toUpperCase();
  return Object.hasOwn(DEFAULT_TREATMENT_ITEM_META, item) ? (DEFAULT_TREATMENT_ITEM_META[item].color ?? null) : null;
}

export function isPremiumItem(meta: TreatmentItemMeta, item: string): boolean {
  return treatmentMetaOf(meta, item).category === "PREMIUM";
}

export function isValidDiscountRate(rate: number): boolean {
  return Number.isInteger(rate) && rate >= 0 && rate <= 100;
}

export function amountAfterDiscount(listPrice: number, discountRate: number): number {
  if (!isValidDiscountRate(discountRate)) throw new RangeError("discountRate");
  return Math.round((listPrice * (100 - discountRate)) / 100);
}
