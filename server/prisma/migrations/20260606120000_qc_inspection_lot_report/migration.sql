-- Add lot report PDF (supplier test report / COA / COC) uploaded by Purchase
-- Officer alongside the invoice when raising the QC inspection request.
-- Idempotent: skips if the column already exists from a partial earlier run.
ALTER TABLE "QCInspection" ADD COLUMN IF NOT EXISTS "lotReportFileUrl" TEXT;
