-- ────────────────────────────────────────────────────────────────────────────
-- WO multi-material line items:
--   • WorkOrderItem      — S.No / Description / Quantity / UOM per WO. A WO can
--     now carry many materials instead of one nomenclature + single qty.
--   • WorkOrderClosureItem — qty of each item dispatched in a given lot, so the
--     multi-material breakdown is followed all the way through delivery.
-- The existing WorkOrder.orderQuantity / orderUnit and WorkOrderClosure.deliveryQty
-- columns are KEPT and back-filled as aggregates (sum of item qty) so PDFs,
-- alarms, SLA, payment and auto-close logic keep working unchanged.
-- All statements idempotent — safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

-- ── WorkOrderItem ──
CREATE TABLE IF NOT EXISTS "WorkOrderItem" (
  "id"          TEXT NOT NULL,
  "workOrderId" TEXT NOT NULL,
  "lineNo"      INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "quantity"    DOUBLE PRECISION NOT NULL,
  "uom"         TEXT NOT NULL DEFAULT 'Nos',
  CONSTRAINT "WorkOrderItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkOrderItem_workOrderId_lineNo_key"
  ON "WorkOrderItem"("workOrderId", "lineNo");
CREATE INDEX IF NOT EXISTS "WorkOrderItem_workOrderId_idx"
  ON "WorkOrderItem"("workOrderId");

DO $$ BEGIN
  ALTER TABLE "WorkOrderItem" ADD CONSTRAINT "WorkOrderItem_workOrderId_fkey"
    FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── WorkOrderClosureItem ──
CREATE TABLE IF NOT EXISTS "WorkOrderClosureItem" (
  "id"          TEXT NOT NULL,
  "closureId"   TEXT NOT NULL,
  "itemId"      TEXT NOT NULL,
  "deliveryQty" DOUBLE PRECISION NOT NULL,
  CONSTRAINT "WorkOrderClosureItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkOrderClosureItem_closureId_itemId_key"
  ON "WorkOrderClosureItem"("closureId", "itemId");
CREATE INDEX IF NOT EXISTS "WorkOrderClosureItem_closureId_idx"
  ON "WorkOrderClosureItem"("closureId");
CREATE INDEX IF NOT EXISTS "WorkOrderClosureItem_itemId_idx"
  ON "WorkOrderClosureItem"("itemId");

DO $$ BEGIN
  ALTER TABLE "WorkOrderClosureItem" ADD CONSTRAINT "WorkOrderClosureItem_closureId_fkey"
    FOREIGN KEY ("closureId") REFERENCES "WorkOrderClosure"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "WorkOrderClosureItem" ADD CONSTRAINT "WorkOrderClosureItem_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "WorkOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Back-fill: turn each existing single-qty WO into a one-line item so old
-- WOs render in the new items table. Uses nomenclature (or description) as the
-- line description and the existing order qty / unit. Only WOs with no items.
INSERT INTO "WorkOrderItem" ("id", "workOrderId", "lineNo", "description", "quantity", "uom")
SELECT
  md5(w."id" || '-item1' || clock_timestamp()::text),
  w."id",
  1,
  COALESCE(NULLIF(w."nomenclature", ''), NULLIF(w."supplyOrderDescription", ''), 'Material'),
  w."orderQuantity",
  COALESCE(NULLIF(w."orderUnit", ''), 'Nos')
FROM "WorkOrder" w
WHERE NOT EXISTS (SELECT 1 FROM "WorkOrderItem" i WHERE i."workOrderId" = w."id");
