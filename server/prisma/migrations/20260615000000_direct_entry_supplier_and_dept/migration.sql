-- Direct / cash-purchase inward (Stores → Direct Entry):
-- Stores can record which supplier the material was bought from (free text —
-- often unregistered local vendors) and which non-unit department it was
-- bought for (Safety, QC, Designs …). Unit assignments keep using
-- StockMovement.unitId + ProductUnitStock; assignedDept is informational.
-- Idempotent: safe to re-run.

ALTER TABLE "ProductBatch" ADD COLUMN IF NOT EXISTS "supplierName" TEXT;
ALTER TABLE "ProductBatch" ADD COLUMN IF NOT EXISTS "supplierContact" TEXT;
ALTER TABLE "ProductBatch" ADD COLUMN IF NOT EXISTS "supplierAddress" TEXT;
ALTER TABLE "ProductBatch" ADD COLUMN IF NOT EXISTS "assignedDept" TEXT;
