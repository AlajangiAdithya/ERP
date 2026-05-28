-- PR/PO closure feature:
--   1. Track per-item quotation progress on PurchaseRequestItem so a PR with 5
--      materials can have 4 already ordered while the 5th sits at "Awaiting
--      quotation" without blocking the others.
--   2. Add CLOSED status + manual close audit columns to PurchaseOrder so the
--      Purchase Officer can close a PO (cleanly or force-closed) with a reason.

-- New enum: per-item quotation status
CREATE TYPE "PRItemQuotationStatus" AS ENUM (
  'AWAITING_QUOTATION',
  'QUOTATION_SUBMITTED',
  'QUOTATION_HELD',
  'QUOTATION_APPROVED',
  'CANCELLED'
);

ALTER TABLE "PurchaseRequestItem"
  ADD COLUMN "itemQuotationStatus" "PRItemQuotationStatus" NOT NULL DEFAULT 'AWAITING_QUOTATION';

-- Extend PO status with CLOSED (distinct from COMPLETED — CLOSED can be a
-- force-close with leftovers cancelled).
ALTER TYPE "PurchaseOrderStatus" ADD VALUE 'CLOSED';

ALTER TABLE "PurchaseOrder"
  ADD COLUMN "closedAt" TIMESTAMP(3),
  ADD COLUMN "closedById" TEXT,
  ADD COLUMN "closeReason" TEXT,
  ADD COLUMN "forceClosed" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_closedById_fkey"
  FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
