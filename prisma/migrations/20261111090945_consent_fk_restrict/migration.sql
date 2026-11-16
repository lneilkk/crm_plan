-- DropForeignKey
ALTER TABLE "consent" DROP CONSTRAINT "consent_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "consent" DROP CONSTRAINT "consent_recorded_by_id_fkey";

-- AddForeignKey
ALTER TABLE "consent" ADD CONSTRAINT "consent_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "consent" ADD CONSTRAINT "consent_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
