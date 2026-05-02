-- ────────────────────────────────────────────────────────────
-- Move supplier from Quotation → QuotationItem (per-product supplier)
-- ────────────────────────────────────────────────────────────

-- Step 1: add nullable supplier columns to QuotationItem
ALTER TABLE "QuotationItem" ADD COLUMN "supplierName" TEXT;
ALTER TABLE "QuotationItem" ADD COLUMN "supplierContact" TEXT;
ALTER TABLE "QuotationItem" ADD COLUMN "supplierAddress" TEXT;

-- Step 2: backfill from parent Quotation so existing rows keep their supplier
UPDATE "QuotationItem" qi
SET "supplierName"    = q."supplierName",
    "supplierContact" = q."supplierContact",
    "supplierAddress" = q."supplierAddress"
FROM "Quotation" q
WHERE qi."quotationId" = q."id";

-- Step 3: enforce NOT NULL on supplierName (every item must name a supplier)
ALTER TABLE "QuotationItem" ALTER COLUMN "supplierName" SET NOT NULL;

-- Step 4: make Quotation.supplierName optional (no longer the source of truth)
ALTER TABLE "Quotation" ALTER COLUMN "supplierName" DROP NOT NULL;
