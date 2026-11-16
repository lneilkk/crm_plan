-- AlterTable
ALTER TABLE "clinic_setting" ADD COLUMN     "status_styles" JSONB;

-- CreateTable
CREATE TABLE "appointment_label" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_label_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_label_link" (
    "appointment_id" UUID NOT NULL,
    "label_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_label_link_pkey" PRIMARY KEY ("appointment_id","label_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "appointment_label_name_key" ON "appointment_label"("name");

-- CreateIndex
CREATE INDEX "appointment_label_link_label_id_idx" ON "appointment_label_link"("label_id");

-- AddForeignKey
ALTER TABLE "appointment_label_link" ADD CONSTRAINT "appointment_label_link_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_label_link" ADD CONSTRAINT "appointment_label_link_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "appointment_label"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 색은 #RRGGBB만, 이름은 1~20자, 순서는 0 이상 (F-2)
ALTER TABLE "appointment_label"
  ADD CONSTRAINT "appointment_label_color_hex" CHECK ("color" ~ '^#[0-9A-Fa-f]{6}$'),
  ADD CONSTRAINT "appointment_label_name_len" CHECK (char_length("name") BETWEEN 1 AND 20),
  ADD CONSTRAINT "appointment_label_sort_order" CHECK ("sort_order" >= 0);

-- 기본 라벨: 관리자가 보여 준 기존 프로그램 범례(2026-11-12)에서 예약 상태가 아닌 항목.
-- 금액 라벨(100·200·300)을 맨 위에 두어 칸 색의 우선 순위가 가장 높다. [편집] 탭에서 바꿀 수 있다.
INSERT INTO "appointment_label" ("id", "name", "color", "sort_order", "updated_at")
-- 기본 키는 UUID v7(앞 48비트 = 밀리초 시각, 버전 7). PostgreSQL 17에는 uuidv7()이 없어 직접 만든다.
SELECT encode(
         set_bit(set_bit(
           overlay(uuid_send(gen_random_uuid())
                   placing substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
                   FROM 1 FOR 6),
           52, 1), 53, 1),
         'hex')::uuid,
       v.name, v.color, v.ord, CURRENT_TIMESTAMP
FROM (VALUES
  ('100', '#A98BD6', 0),
  ('200', '#F2E21B', 1),
  ('300', '#F48FB1', 2),
  ('vip', '#8FB0CC', 3),
  ('초진', '#1E73E8', 4),
  ('재진', '#7B61F0', 5),
  ('노쇼후보', '#F5A000', 6),
  ('상담실패', '#B3261E', 7),
  ('미연결', '#111111', 8),
  ('@', '#E91E8C', 9),
  ('@@', '#8E24AA', 10),
  ('미동의', '#1B8E2D', 11),
  ('외출', '#FFF59D', 12),
  ('의료지원사업', '#C6E81B', 13),
  ('인바운드', '#9C27B0', 14),
  ('일반진료', '#22D3EE', 15),
  ('전화상담완료', '#1A0DAB', 16),
  ('진료중', '#7CDB1E', 17),
  ('포폴수면', '#FFB3A7', 18),
  ('해외거주', '#F8C8E0', 19)
) AS v(name, color, ord)
WHERE NOT EXISTS (SELECT 1 FROM "appointment_label");
