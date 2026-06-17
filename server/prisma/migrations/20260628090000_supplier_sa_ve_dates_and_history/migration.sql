-- Supplier Assessment (SA) is now the PRIMARY evaluation with a Purchase-entered
-- document date; valid 1 year from that date. Vendor Re-Evaluation (VE) becomes a
-- yearly, history-kept document — latest row is active, older rows retained.

-- Document dates entered by the Purchase Officer.
ALTER TABLE "Supplier" ADD COLUMN "supplierAssessmentDate" TIMESTAMP(3);
ALTER TABLE "Supplier" ADD COLUMN "vendorEvaluationDate" TIMESTAMP(3);

-- Vendor Re-Evaluation history (one row per yearly re-evaluation PDF).
CREATE TABLE "SupplierVendorEvaluation" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "pdfUrl" TEXT NOT NULL,
    "documentDate" TIMESTAMP(3) NOT NULL,
    "uploadedByUserId" TEXT,
    "uploadedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierVendorEvaluation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplierVendorEvaluation_supplierId_idx" ON "SupplierVendorEvaluation"("supplierId");

ALTER TABLE "SupplierVendorEvaluation"
    ADD CONSTRAINT "SupplierVendorEvaluation_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: any existing single VE PDF becomes the first history row so it stays
-- visible; its document date is unknown (grandfathered as valid until re-uploaded).
INSERT INTO "SupplierVendorEvaluation" ("id", "supplierId", "pdfUrl", "documentDate", "createdAt")
SELECT gen_random_uuid(), "id", "vendorEvaluationPdfUrl",
       COALESCE("vendorEvaluationUploadedAt", CURRENT_TIMESTAMP), CURRENT_TIMESTAMP
FROM "Supplier"
WHERE "vendorEvaluationPdfUrl" IS NOT NULL;
