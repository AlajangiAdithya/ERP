-- Add CASH_PURCHASE to PurchaseRequestStatus enum
ALTER TYPE "PurchaseRequestStatus" ADD VALUE IF NOT EXISTS 'CASH_PURCHASE';

-- Add cashPurchaseRequestId to MaterialInwardRegister
ALTER TABLE "MaterialInwardRegister"
  ADD COLUMN IF NOT EXISTS "cashPurchaseRequestId" TEXT;

-- Foreign key constraint
ALTER TABLE "MaterialInwardRegister"
  ADD CONSTRAINT "MaterialInwardRegister_cashPurchaseRequestId_fkey"
  FOREIGN KEY ("cashPurchaseRequestId")
  REFERENCES "PurchaseRequest"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Index
CREATE INDEX IF NOT EXISTS "MaterialInwardRegister_cashPurchaseRequestId_idx"
  ON "MaterialInwardRegister"("cashPurchaseRequestId");
