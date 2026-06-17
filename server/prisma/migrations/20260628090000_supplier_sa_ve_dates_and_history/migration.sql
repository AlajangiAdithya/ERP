-- Supplier Assessment (SA) is now the PRIMARY evaluation with a Purchase-entered
-- document date; valid 1 year from that date. Vendor Re-Evaluation (VE) becomes a
-- yearly, history-kept document — latest row is active, older rows retained.
-- Written idempotently so it recovers cleanly if columns were added out-of-band.

-- Document dates entered by the Purchase Officer.
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "supplierAssessmentDate" TIMESTAMP(3);
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "vendorEvaluationDate" TIMESTAMP(3);

-- Vendor Re-Evaluation history (one row per yearly re-evaluation PDF).
CREATE TABLE IF NOT EXISTS "SupplierVendorEvaluation" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "pdfUrl" TEXT NOT NULL,
    "documentDate" TIMESTAMP(3) NOT NULL,
    "uploadedByUserId" TEXT,
    "uploadedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierVendorEvaluation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SupplierVendorEvaluation_supplierId_idx" ON "SupplierVendorEvaluation"("supplierId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SupplierVendorEvaluation_supplierId_fkey'
  ) THEN
    ALTER TABLE "SupplierVendorEvaluation"
      ADD CONSTRAINT "SupplierVendorEvaluation_supplierId_fkey"
      FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill: existing single VE PDF becomes the first history row so it stays
-- visible. Only runs when the table is still empty (safe to re-run).
INSERT INTO "SupplierVendorEvaluation" ("id", "supplierId", "pdfUrl", "documentDate", "createdAt")
SELECT gen_random_uuid(), "id", "vendorEvaluationPdfUrl",
       COALESCE("vendorEvaluationUploadedAt", CURRENT_TIMESTAMP), CURRENT_TIMESTAMP
FROM "Supplier"
WHERE "vendorEvaluationPdfUrl" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "SupplierVendorEvaluation");
