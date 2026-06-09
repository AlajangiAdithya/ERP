-- Audit-pass additions:
--  1) PurchaseOrder.quotation now uses ON DELETE RESTRICT explicitly. The
--     prior default (NoAction) already rejects orphaning deletes; this just
--     makes the behaviour explicit and aligns with Postgres convention.
--  2) Explicit indexes on FK columns that didn't have one. These accelerate
--     lookups by purchaseOrderId, productId, etc. — purely additive, no
--     read/write semantic change.
--
-- Idempotent: safe to re-run after a partial earlier apply.

-- Drop the old FK if present, then re-add with explicit RESTRICT.
ALTER TABLE "PurchaseOrder" DROP CONSTRAINT IF EXISTS "PurchaseOrder_quotationId_fkey";
DO $$ BEGIN
  ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_quotationId_fkey"
    FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- PurchaseOrderItem FK indexes
CREATE INDEX IF NOT EXISTS "PurchaseOrderItem_purchaseOrderId_idx"        ON "PurchaseOrderItem"("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "PurchaseOrderItem_productId_idx"              ON "PurchaseOrderItem"("productId");
CREATE INDEX IF NOT EXISTS "PurchaseOrderItem_purchaseRequestItemId_idx"  ON "PurchaseOrderItem"("purchaseRequestItemId");
CREATE INDEX IF NOT EXISTS "PurchaseOrderItem_supplierId_idx"             ON "PurchaseOrderItem"("supplierId");

CREATE INDEX IF NOT EXISTS "PurchaseOrderItemAllocation_purchaseRequestItemId_idx"
  ON "PurchaseOrderItemAllocation"("purchaseRequestItemId");

CREATE INDEX IF NOT EXISTS "PurchaseOrderSource_purchaseRequestId_idx"
  ON "PurchaseOrderSource"("purchaseRequestId");

-- QCInspection FK indexes
CREATE INDEX IF NOT EXISTS "QCInspection_purchaseOrderId_idx"     ON "QCInspection"("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "QCInspection_inspectedById_idx"       ON "QCInspection"("inspectedById");
CREATE INDEX IF NOT EXISTS "QCInspection_requestCreatedById_idx"  ON "QCInspection"("requestCreatedById");

-- GatePassItem FK indexes
CREATE INDEX IF NOT EXISTS "GatePassItem_gatePassId_idx"                  ON "GatePassItem"("gatePassId");
CREATE INDEX IF NOT EXISTS "GatePassItem_sourceInwardGatePassItemId_idx"  ON "GatePassItem"("sourceInwardGatePassItemId");
