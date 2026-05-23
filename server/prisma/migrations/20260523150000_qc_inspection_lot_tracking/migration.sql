-- ────────────────────────────────────────────────────────────
-- Per-lot delivery tracking on QCInspection
-- - lotNumber:       sequential per PO (Lot 1, 2, 3…) so each "mark goods arrived"
--                    batch is identifiable across PO/QC/inward.
-- - arrivedQty:      total qty arrived in this lot (sum of QCInspectionItem.arrivedQty).
-- - invoiceFileUrl:  invoice PDF uploaded by Purchase Officer for this lot,
--                    surfaced to QC alongside PR specs + PO annexure.
-- - QCInspectionItem: per-PO-item arrived qty rows (Lot N: item A 400, item B 100).
-- ────────────────────────────────────────────────────────────

ALTER TABLE "QCInspection" ADD COLUMN IF NOT EXISTS "lotNumber"      INTEGER;
ALTER TABLE "QCInspection" ADD COLUMN IF NOT EXISTS "arrivedQty"     DOUBLE PRECISION;
ALTER TABLE "QCInspection" ADD COLUMN IF NOT EXISTS "invoiceFileUrl" TEXT;

-- Backfill lotNumber for existing inspections: order by creation per PO.
WITH numbered AS (
  SELECT "id",
         ROW_NUMBER() OVER (PARTITION BY "purchaseOrderId" ORDER BY "createdAt") AS rn
  FROM "QCInspection"
)
UPDATE "QCInspection" q
SET "lotNumber" = numbered.rn
FROM numbered
WHERE q."id" = numbered."id" AND q."lotNumber" IS NULL;

CREATE TABLE IF NOT EXISTS "QCInspectionItem" (
  "id"                  TEXT NOT NULL,
  "inspectionId"        TEXT NOT NULL,
  "purchaseOrderItemId" TEXT NOT NULL,
  "arrivedQty"          DOUBLE PRECISION NOT NULL,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QCInspectionItem_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "QCInspectionItem"
    ADD CONSTRAINT "QCInspectionItem_inspectionId_fkey"
    FOREIGN KEY ("inspectionId") REFERENCES "QCInspection"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "QCInspectionItem"
    ADD CONSTRAINT "QCInspectionItem_purchaseOrderItemId_fkey"
    FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "QCInspectionItem_inspectionId_idx"        ON "QCInspectionItem" ("inspectionId");
CREATE INDEX IF NOT EXISTS "QCInspectionItem_purchaseOrderItemId_idx" ON "QCInspectionItem" ("purchaseOrderItemId");

-- ProductBatch.sourceQcInspectionId — link each inwarded batch to its source lot
-- so the product list can show PR → PO → Lot N (invoice) → Batch chain.
ALTER TABLE "ProductBatch" ADD COLUMN IF NOT EXISTS "sourceQcInspectionId" TEXT;

DO $$ BEGIN
  ALTER TABLE "ProductBatch"
    ADD CONSTRAINT "ProductBatch_sourceQcInspectionId_fkey"
    FOREIGN KEY ("sourceQcInspectionId") REFERENCES "QCInspection"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "ProductBatch_sourceQcInspectionId_idx" ON "ProductBatch" ("sourceQcInspectionId");
