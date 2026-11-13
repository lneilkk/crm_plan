-- AlterTable
ALTER TABLE "consultation" ADD COLUMN     "is_new_patient" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "outcome" TEXT;
