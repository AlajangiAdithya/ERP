-- Adds a per-FY recall date alongside the existing dueDate (calibration due date)
-- on CalibrationRecord, so the MMR register can track both dates side by side.
ALTER TABLE "CalibrationRecord" ADD COLUMN "recallDate" TIMESTAMP(3);
