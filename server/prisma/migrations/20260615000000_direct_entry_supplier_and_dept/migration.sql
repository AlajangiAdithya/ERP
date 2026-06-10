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

-- Mfg / expiry entered by Stores on direct entries (PO-flow batches read these
-- from the linked QC inspection instead).
ALTER TABLE "ProductBatch" ADD COLUMN IF NOT EXISTS "dateOfManufacturing" TIMESTAMP(3);
ALTER TABLE "ProductBatch" ADD COLUMN IF NOT EXISTS "dateOfExpiry" TIMESTAMP(3);
