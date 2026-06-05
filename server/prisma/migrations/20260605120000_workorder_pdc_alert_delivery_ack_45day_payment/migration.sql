-- Work Order workflow additions:
--   1. 3-month PDC alert + admin acknowledge fields (red blinking button)
--   2. Closure DELIVERY_ACKNOWLEDGED stage (Finance acks customer receipt of
--      invoice + delivery challan; stops 48h SLA, starts 45-day payment window)
--   3. Weekly follow-up records for the 45-day payment window
--   4. paymentDueAt / paymentDelayedAt / lastWeeklyReminderAt on the closure cycle

-- 1. 3-month PDC alert columns on WorkOrder
ALTER TABLE "WorkOrder"
  ADD COLUMN IF NOT EXISTS "pdc3MonthAckAt"           TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pdc3MonthAckById"         TEXT,
  ADD COLUMN IF NOT EXISTS "pdc3MonthAckNote"         TEXT,
  ADD COLUMN IF NOT EXISTS "pdc3MonthAlertNotifiedAt" TIMESTAMP(3);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkOrder_pdc3MonthAckById_fkey') THEN
    ALTER TABLE "WorkOrder"
      ADD CONSTRAINT "WorkOrder_pdc3MonthAckById_fkey"
      FOREIGN KEY ("pdc3MonthAckById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 2. New closure stage value
ALTER TYPE "WorkOrderClosureStage" ADD VALUE IF NOT EXISTS 'DELIVERY_ACKNOWLEDGED' AFTER 'INVOICE_SENT';

-- 3. Delivery ack + 45-day payment window columns on WorkOrderClosure
ALTER TABLE "WorkOrderClosure"
  ADD COLUMN IF NOT EXISTS "deliveryAckAt"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deliveryAckById"      TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryAckNote"      TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryAckSignedUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentDueAt"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paymentDelayedAt"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastWeeklyReminderAt" TIMESTAMP(3);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkOrderClosure_deliveryAckById_fkey') THEN
    ALTER TABLE "WorkOrderClosure"
      ADD CONSTRAINT "WorkOrderClosure_deliveryAckById_fkey"
      FOREIGN KEY ("deliveryAckById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "WorkOrderClosure_paymentDueAt_idx" ON "WorkOrderClosure"("paymentDueAt");

-- 4. Weekly follow-up table
CREATE TABLE IF NOT EXISTS "WorkOrderClosureWeeklyFollowup" (
  "id"               TEXT         NOT NULL,
  "closureId"        TEXT         NOT NULL,
  "weekNumber"       INTEGER      NOT NULL,
  "contactedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "contactedById"    TEXT         NOT NULL,
  "customerResponse" TEXT,
  "note"             TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkOrderClosureWeeklyFollowup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WorkOrderClosureWeeklyFollowup_closureId_idx"
  ON "WorkOrderClosureWeeklyFollowup"("closureId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkOrderClosureWeeklyFollowup_closureId_fkey') THEN
    ALTER TABLE "WorkOrderClosureWeeklyFollowup"
      ADD CONSTRAINT "WorkOrderClosureWeeklyFollowup_closureId_fkey"
      FOREIGN KEY ("closureId") REFERENCES "WorkOrderClosure"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkOrderClosureWeeklyFollowup_contactedById_fkey') THEN
    ALTER TABLE "WorkOrderClosureWeeklyFollowup"
      ADD CONSTRAINT "WorkOrderClosureWeeklyFollowup_contactedById_fkey"
      FOREIGN KEY ("contactedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
