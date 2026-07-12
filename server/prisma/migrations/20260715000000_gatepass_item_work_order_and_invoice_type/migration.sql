-- Gate Pass line items: link each dispatched component to a Work Order, and add
-- INVOICE as a per-line pass type (alongside RETURNABLE / NON_RETURNABLE /
-- DELIVERY_CHALLAN) so material can go out as an invoice/DC/machining item.

-- New pass type value (invoice items are delivery items — no probable return).
ALTER TYPE "GatePassType" ADD VALUE IF NOT EXISTS 'INVOICE';

-- Per-line Work Order link (optional; any live WO, any unit).
ALTER TABLE "GatePassItem" ADD COLUMN IF NOT EXISTS "workOrderId" TEXT;

DO $$ BEGIN
  ALTER TABLE "GatePassItem"
    ADD CONSTRAINT "GatePassItem_workOrderId_fkey"
    FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "GatePassItem_workOrderId_idx" ON "GatePassItem"("workOrderId");
