-- Material Inward Register — per-PO lot numbering + the Stores inspection-request
-- form snapshot. Additive: two nullable columns on MaterialInwardRegister.
--   lotNo:     sequential per PO (Lot 1, 2, 3 … N); one per partial receipt.
--   qcRequest: JSON snapshot of the inward-inspection request form Stores fills
--              when handing a lot to QC (packing condition, documents enclosed,
--              stores remark). Header fields are auto-filled from the row itself.

ALTER TABLE "MaterialInwardRegister" ADD COLUMN IF NOT EXISTS "lotNo"     INTEGER;
ALTER TABLE "MaterialInwardRegister" ADD COLUMN IF NOT EXISTS "qcRequest" JSONB;
