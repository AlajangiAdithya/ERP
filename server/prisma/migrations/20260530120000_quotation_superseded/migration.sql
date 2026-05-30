-- Soft-archive flag for competing quotations pushed out by a winning approval.
-- The row stays in DB so the product's Supplier History tab can still surface
-- the supplier + price ("Quoted but not bought"). All live queues filter
-- supersededAt IS NULL.
ALTER TABLE "Quotation"
  ADD COLUMN "supersededAt"            TIMESTAMP(3),
  ADD COLUMN "supersededByQuotationId" TEXT;

ALTER TABLE "Quotation"
  ADD CONSTRAINT "Quotation_supersededByQuotationId_fkey"
  FOREIGN KEY ("supersededByQuotationId") REFERENCES "Quotation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Quotation_supersededAt_idx" ON "Quotation"("supersededAt");
