-- Credit-based order placement: PO Officer can place an order on word-of-trust
-- before any payment is processed. The order proceeds through goods/QC/inward
-- exactly like a paid order; the payment request is raised and processed later.

ALTER TYPE "PurchaseOrderStatus" ADD VALUE IF NOT EXISTS 'CREDIT_PLACED';

ALTER TABLE "PurchaseOrder"
  ADD COLUMN "isCreditOrder"    BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN "creditPlacedAt"   TIMESTAMP(3),
  ADD COLUMN "creditPlacedById" TEXT,
  ADD COLUMN "creditNote"       TEXT;

ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_creditPlacedById_fkey"
  FOREIGN KEY ("creditPlacedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
