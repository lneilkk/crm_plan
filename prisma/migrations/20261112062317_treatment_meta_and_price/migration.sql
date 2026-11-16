-- AlterTable
ALTER TABLE "appointment" ADD COLUMN     "discount_rate" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "list_price" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "clinic_setting" ADD COLUMN     "treatment_item_meta" JSONB;

-- 할인율 0~100%, 단가 0원 이상 (F-6)
ALTER TABLE "appointment"
  ADD CONSTRAINT "appointment_discount_rate_range" CHECK ("discount_rate" BETWEEN 0 AND 100),
  ADD CONSTRAINT "appointment_list_price_nonneg" CHECK ("list_price" >= 0);

-- 예약 항목 기본 구분·단가(src/lib/domain/treatment.ts DEFAULT_TREATMENT_ITEM_META와 같음, 단가는 예시 값).
-- 기본 목록에 없던 '라미네이트'(고가)를 더한다. 관리자가 캘린더 [편집] 탭에서 바꾼다.
UPDATE "clinic_setting"
SET "treatment_items" = CASE
      WHEN "treatment_items" @> '["라미네이트"]'::jsonb THEN "treatment_items"
      ELSE "treatment_items" || '["라미네이트"]'::jsonb
    END,
    "treatment_item_meta" = '{
      "정기검진": {"category": "GENERAL", "price": 20000},
      "스케일링": {"category": "GENERAL", "price": 15000},
      "충치 치료": {"category": "GENERAL", "price": 50000},
      "신경 치료": {"category": "GENERAL", "price": 150000},
      "발치": {"category": "GENERAL", "price": 50000},
      "미백": {"category": "GENERAL", "price": 300000},
      "임플란트": {"category": "PREMIUM", "price": 1200000},
      "라미네이트": {"category": "PREMIUM", "price": 600000},
      "교정": {"category": "PREMIUM", "price": 3000000},
      "보철": {"category": "PREMIUM", "price": 500000},
      "상담": {"category": "PREMIUM", "price": 0}
    }'::jsonb
WHERE "treatment_item_meta" IS NULL;

-- 이미 있는 예약에 그 항목의 단가를 채운다(실적 금액). 설정에 없는 항목은 0원 그대로.
UPDATE "appointment" a
SET "list_price" = (s."treatment_item_meta" -> a."treatment_item" ->> 'price')::int
FROM "clinic_setting" s
WHERE s."id" = 1 AND s."treatment_item_meta" ? a."treatment_item";
