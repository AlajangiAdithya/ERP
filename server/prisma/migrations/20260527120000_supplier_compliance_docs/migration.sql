-- Vendor Evaluation (once per supplier, never expires) and Supplier Assessment
-- (per Indian financial year) PDFs. Both are uploaded by the Purchase Officer
-- before the supplier can be used on a new quotation.
ALTER TABLE "Supplier" ADD COLUMN "vendorEvaluationPdfUrl" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "vendorEvaluationUploadedAt" TIMESTAMP(3);
ALTER TABLE "Supplier" ADD COLUMN "supplierAssessmentPdfUrl" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "assessmentFiscalYear" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "assessmentUploadedAt" TIMESTAMP(3);
