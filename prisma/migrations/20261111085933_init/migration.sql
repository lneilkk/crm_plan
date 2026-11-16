-- CreateEnum
CREATE TYPE "staff_role" AS ENUM ('FRONT', 'COUNSELOR', 'DOCTOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "gender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "visit_type" AS ENUM ('NEW', 'RETURNING');

-- CreateEnum
CREATE TYPE "referral_source" AS ENUM ('PHONE', 'WEBSITE', 'PLATFORM', 'REFERRAL', 'OTHER');

-- CreateEnum
CREATE TYPE "consent_type" AS ENUM ('PRIVACY', 'SENSITIVE', 'MARKETING');

-- CreateEnum
CREATE TYPE "appointment_status" AS ENUM ('BOOKED', 'CONFIRMED', 'ARRIVED', 'NO_SHOW', 'CANCELED_SAME_DAY', 'CANCELED_ADVANCE', 'RESCHEDULED', 'IN_TREATMENT', 'PAID', 'LEFT');

-- CreateEnum
CREATE TYPE "appointment_channel" AS ENUM ('PHONE', 'WEBSITE', 'PLATFORM', 'ONSITE', 'WALK_IN');

-- CreateEnum
CREATE TYPE "visit_reason_code" AS ENUM ('NO_CONTACT', 'PERSONAL', 'OTHER_CLINIC', 'OTHER');

-- CreateEnum
CREATE TYPE "consultation_result" AS ENUM ('PENDING', 'BOOKED', 'NOT_BOOKED');

-- CreateEnum
CREATE TYPE "audit_result" AS ENUM ('SUCCESS', 'DENIED', 'FAILED');

-- CreateTable
CREATE TABLE "patient" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone_enc" TEXT NOT NULL,
    "phone_hash" TEXT NOT NULL,
    "phone_last4_hash" TEXT NOT NULL,
    "birth_date_enc" TEXT,
    "gender" "gender",
    "visit_type" "visit_type" NOT NULL DEFAULT 'NEW',
    "referral_source" "referral_source",
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "no_show_count" INTEGER NOT NULL DEFAULT 0,
    "dentweb_chart_no" TEXT,
    "memo" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "type" "consent_type" NOT NULL,
    "agreed" BOOLEAN NOT NULL,
    "agreed_at" TIMESTAMPTZ(3),
    "withdrawn_at" TIMESTAMPTZ(3),
    "recorded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff" (
    "id" UUID NOT NULL,
    "login_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "staff_role" NOT NULL,
    "branch" TEXT NOT NULL DEFAULT '본점',
    "password_hash" TEXT NOT NULL,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_at" TIMESTAMPTZ(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "staff_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_min" INTEGER NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "doctor_id" UUID,
    "counselor_id" UUID,
    "chair" TEXT NOT NULL,
    "treatment_item" TEXT NOT NULL,
    "channel" "appointment_channel" NOT NULL,
    "status" "appointment_status" NOT NULL DEFAULT 'BOOKED',
    "arrived_at" TIMESTAMPTZ(3),
    "original_appointment_id" UUID,
    "memo" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_status_log" (
    "id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "from_status" "appointment_status",
    "to_status" "appointment_status" NOT NULL,
    "reason_code" "visit_reason_code",
    "staff_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "input_device" TEXT,

    CONSTRAINT "visit_status_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "counselor_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "interested_items" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "result" "consultation_result" NOT NULL DEFAULT 'PENDING',
    "appointment_id" UUID,
    "consulted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consultation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_setting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "late_tolerance_min" INTEGER NOT NULL DEFAULT 15,
    "no_show_grace_min" INTEGER NOT NULL DEFAULT 30,
    "business_hours" JSONB NOT NULL,
    "chairs" JSONB NOT NULL,
    "treatment_items" JSONB NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinic_setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "staff_id" UUID,
    "action" TEXT NOT NULL,
    "patient_id" UUID,
    "ip" TEXT,
    "user_agent" TEXT,
    "result" "audit_result" NOT NULL DEFAULT 'SUCCESS',
    "detail" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "patient_dentweb_chart_no_key" ON "patient"("dentweb_chart_no");

-- CreateIndex
CREATE INDEX "patient_name_idx" ON "patient"("name");

-- CreateIndex
CREATE INDEX "patient_phone_hash_idx" ON "patient"("phone_hash");

-- CreateIndex
CREATE INDEX "patient_phone_last4_hash_idx" ON "patient"("phone_last4_hash");

-- CreateIndex
CREATE INDEX "consent_patient_id_type_created_at_idx" ON "consent"("patient_id", "type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "staff_login_id_key" ON "staff"("login_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_hash_key" ON "session"("token_hash");

-- CreateIndex
CREATE INDEX "session_staff_id_idx" ON "session"("staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_original_appointment_id_key" ON "appointment"("original_appointment_id");

-- CreateIndex
CREATE INDEX "appointment_start_at_idx" ON "appointment"("start_at");

-- CreateIndex
CREATE INDEX "appointment_patient_id_start_at_idx" ON "appointment"("patient_id", "start_at");

-- CreateIndex
CREATE INDEX "appointment_doctor_id_start_at_idx" ON "appointment"("doctor_id", "start_at");

-- CreateIndex
CREATE INDEX "appointment_status_start_at_idx" ON "appointment"("status", "start_at");

-- CreateIndex
CREATE INDEX "visit_status_log_appointment_id_created_at_idx" ON "visit_status_log"("appointment_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "consultation_appointment_id_key" ON "consultation"("appointment_id");

-- CreateIndex
CREATE INDEX "consultation_patient_id_consulted_at_idx" ON "consultation"("patient_id", "consulted_at");

-- CreateIndex
CREATE INDEX "consultation_counselor_id_consulted_at_idx" ON "consultation"("counselor_id", "consulted_at");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE INDEX "audit_log_staff_id_created_at_idx" ON "audit_log"("staff_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_patient_id_created_at_idx" ON "audit_log"("patient_id", "created_at");

-- AddForeignKey
ALTER TABLE "patient" ADD CONSTRAINT "patient_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent" ADD CONSTRAINT "consent_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent" ADD CONSTRAINT "consent_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_counselor_id_fkey" FOREIGN KEY ("counselor_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_original_appointment_id_fkey" FOREIGN KEY ("original_appointment_id") REFERENCES "appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_status_log" ADD CONSTRAINT "visit_status_log_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "visit_status_log" ADD CONSTRAINT "visit_status_log_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_counselor_id_fkey" FOREIGN KEY ("counselor_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_setting" ADD CONSTRAINT "clinic_setting_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 직접 작성한 제약 — Prisma 스키마로는 표현할 수 없어 여기에 둔다.
-- Prisma는 CHECK·EXCLUDE 제약을 비교 대상에서 빼므로 다음 마이그레이션이 이것들을 지우지 않는다
-- (T1-1에서 prisma migrate diff로 확인). 이름을 바꾸거나 지울 때는 새 마이그레이션에 직접 적는다.
-- ---------------------------------------------------------------------------

-- 같은 체어(방)에 시간이 겹치는 예약을 DB 수준에서 막는다.
-- 앱의 사전 검사만으로는 두 사람이 동시에 같은 시간을 잡는 경우를 막을 수 없다.
-- 범위는 '[)'(끝 시각 미포함)이라 10:00~10:30 다음에 10:30~11:00을 넣을 수 있다.
-- 체어 시간을 차지하는 상태(src/lib/domain/appointment.ts SLOT_HOLDING_STATUSES)만 검사한다.
-- 노쇼·당일취소·사전취소·예약변경된 예약은 자리를 비우므로 그 시간에 새 예약을 넣을 수 있다.
-- text 컬럼(chair)의 '=' 비교를 gist 인덱스에서 쓰려면 btree_gist 확장이 필요하다.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "appointment" ADD CONSTRAINT "appointment_no_chair_overlap"
    EXCLUDE USING gist ("chair" WITH =, tstzrange("start_at", "end_at", '[)') WITH &&)
    WHERE ("status" IN ('BOOKED', 'CONFIRMED', 'ARRIVED', 'IN_TREATMENT', 'PAID', 'LEFT'));

-- 소요시간은 5분~8시간.
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_duration_min_check"
    CHECK ("duration_min" BETWEEN 5 AND 480);

-- 종료 시각은 항상 시작 시각 + 소요시간. 중복 예약 제약이 이 값을 믿으므로 어긋난 값을 받지 않는다.
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_end_at_check"
    CHECK ("end_at" = "start_at" + make_interval(mins => "duration_min"));

-- 병원 설정은 항상 1행(id = 1)만 있다.
ALTER TABLE "clinic_setting" ADD CONSTRAINT "clinic_setting_single_row_check"
    CHECK ("id" = 1);

-- 노쇼 누적 횟수는 음수가 될 수 없다.
ALTER TABLE "patient" ADD CONSTRAINT "patient_no_show_count_check"
    CHECK ("no_show_count" >= 0);
