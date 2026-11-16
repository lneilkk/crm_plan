-- CreateTable
CREATE TABLE "appointment_participant" (
    "appointment_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_participant_pkey" PRIMARY KEY ("appointment_id","staff_id")
);

-- CreateTable
CREATE TABLE "surgery_note" (
    "appointment_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surgery_note_pkey" PRIMARY KEY ("appointment_id")
);

-- CreateIndex
CREATE INDEX "appointment_participant_staff_id_idx" ON "appointment_participant"("staff_id");

-- AddForeignKey
ALTER TABLE "appointment_participant" ADD CONSTRAINT "appointment_participant_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_participant" ADD CONSTRAINT "appointment_participant_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_note" ADD CONSTRAINT "surgery_note_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_note" ADD CONSTRAINT "surgery_note_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
