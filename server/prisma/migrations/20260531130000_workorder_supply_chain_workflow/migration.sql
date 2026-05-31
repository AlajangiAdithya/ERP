-- Supply Chain workflow additions for Work Orders.
-- Adds the ORDER_REVIEW status (before PENDING_ADMIN), order review/approval
-- audit fields, nomenclature, delivery details, and PDC-extension companion
-- fields (BG extension upto, request-letter status, PRC status).

-- 1. New status value on the existing enum.
ALTER TYPE "WorkOrderStatus" ADD VALUE IF NOT EXISTS 'ORDER_REVIEW' BEFORE 'PENDING_ADMIN';

-- 2. New columns on WorkOrder.
ALTER TABLE "WorkOrder"
  ADD COLUMN IF NOT EXISTS "nomenclature"               TEXT,
  ADD COLUMN IF NOT EXISTS "orderReviewedAt"            TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "orderReviewedById"          TEXT,
  ADD COLUMN IF NOT EXISTS "orderReviewNote"            TEXT,
  ADD COLUMN IF NOT EXISTS "orderApprovedAt"            TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "orderApprovedById"          TEXT,
  ADD COLUMN IF NOT EXISTS "orderApprovalNote"          TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryDetails"            TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryDetailsUpdatedAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deliveryDetailsUpdatedById" TEXT;

-- 3. FK constraints for the new user references.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkOrder_orderReviewedById_fkey') THEN
    ALTER TABLE "WorkOrder"
      ADD CONSTRAINT "WorkOrder_orderReviewedById_fkey"
      FOREIGN KEY ("orderReviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkOrder_orderApprovedById_fkey') THEN
    ALTER TABLE "WorkOrder"
      ADD CONSTRAINT "WorkOrder_orderApprovedById_fkey"
      FOREIGN KEY ("orderApprovedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkOrder_deliveryDetailsUpdatedById_fkey') THEN
    ALTER TABLE "WorkOrder"
      ADD CONSTRAINT "WorkOrder_deliveryDetailsUpdatedById_fkey"
      FOREIGN KEY ("deliveryDetailsUpdatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 4. Move the default status to ORDER_REVIEW for new rows.
ALTER TABLE "WorkOrder" ALTER COLUMN "status" SET DEFAULT 'ORDER_REVIEW';

-- 5. New PDC-extension companion fields.
ALTER TABLE "WorkOrderExtension"
  ADD COLUMN IF NOT EXISTS "bankGuaranteeExtendedUpto" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "requestLetterStatus"       TEXT,
  ADD COLUMN IF NOT EXISTS "prcStatus"                 TEXT;
