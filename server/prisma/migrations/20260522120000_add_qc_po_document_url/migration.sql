-- Add poDocumentUrl: signed/scanned PO PDF that Purchase Officer attaches when sending the QC request.
-- QC reads this column to show the real PO document (not the auto-generated one) alongside the PR and annexure.
ALTER TABLE "QCInspection" ADD COLUMN "poDocumentUrl" TEXT;
