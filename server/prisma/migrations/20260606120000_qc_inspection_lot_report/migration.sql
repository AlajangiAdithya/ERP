-- Add lot report PDF (supplier test report / COA / COC) uploaded by Purchase
-- Officer alongside the invoice when raising the QC inspection request.
ALTER TABLE "QCInspection" ADD COLUMN "lotReportFileUrl" TEXT;
