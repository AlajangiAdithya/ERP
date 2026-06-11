-- Department-reserved stock + cross-owner inventory transfers.
--
-- ProductDeptStock is the per-department counterpart to ProductUnitStock: stock
-- inwarded for a non-unit department (QC, Designs, Safety, Lab, Metrology, NDT,
-- Planning) is reserved to that department and excluded from the unassigned pool,
-- so only the owner can issue it via a MIV. Others must raise an inventory transfer.
-- InventoryTransferRequest is generalised so either side can be a unit OR a dept.
-- Idempotent: safe to re-run.

-- ── ProductDeptStock (mirror of ProductUnitStock) ──
CREATE TABLE IF NOT EXISTS "ProductDeptStock" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "dept" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductDeptStock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductDeptStock_productId_dept_key" ON "ProductDeptStock"("productId", "dept");
CREATE INDEX IF NOT EXISTS "ProductDeptStock_dept_idx" ON "ProductDeptStock"("dept");

DO $$ BEGIN
  ALTER TABLE "ProductDeptStock" ADD CONSTRAINT "ProductDeptStock_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Generalise InventoryTransferRequest to unit-OR-dept owners ──
ALTER TABLE "InventoryTransferRequest" ALTER COLUMN "fromUnitId" DROP NOT NULL;
ALTER TABLE "InventoryTransferRequest" ALTER COLUMN "toUnitId" DROP NOT NULL;
ALTER TABLE "InventoryTransferRequest" ADD COLUMN IF NOT EXISTS "fromDept" TEXT;
ALTER TABLE "InventoryTransferRequest" ADD COLUMN IF NOT EXISTS "toDept" TEXT;

-- ── Backfill: reserve the stock that has already been inwarded for a department.
-- Sums the current remaining of dept-tagged, non-FIM lots — exactly what is still
-- physically on hand for that department right now. Stores/'Others' are excluded.
INSERT INTO "ProductDeptStock" ("id", "productId", "dept", "quantity", "updatedAt", "createdAt")
SELECT gen_random_uuid(), b."productId", b."assignedDept", SUM(b."remaining"), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "ProductBatch" b
WHERE b."assignedDept" IS NOT NULL
  AND b."remaining" > 0
  AND b."isFim" = false
  AND b."assignedDept" IN ('QC', 'Designs', 'Safety', 'Lab', 'Metrology', 'NDT', 'Planning')
GROUP BY b."productId", b."assignedDept"
ON CONFLICT ("productId", "dept") DO UPDATE SET "quantity" = EXCLUDED."quantity";
