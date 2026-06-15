-- Material Inward Register — multi-unit split, QC hold / re-inspection, and the
-- QC-confirmed Inward Inspection No. All additive & nullable (safe).

-- ON_HOLD inward status: QC held the lot (pending docs / retest); it can be
-- resent to QC for re-inspection.
DO $$ BEGIN
  ALTER TYPE "InwardStatus" ADD VALUE IF NOT EXISTS 'ON_HOLD';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Per-unit allocation for the PO line (single unit, union split, or empty/dept).
ALTER TABLE "MaterialInwardRegister" ADD COLUMN IF NOT EXISTS "unitAllocations" JSONB;

-- QC hold + re-inspection bookkeeping.
ALTER TABLE "MaterialInwardRegister" ADD COLUMN IF NOT EXISTS "qtyHeld"    DOUBLE PRECISION;
ALTER TABLE "MaterialInwardRegister" ADD COLUMN IF NOT EXISTS "holdReason" TEXT;
ALTER TABLE "MaterialInwardRegister" ADD COLUMN IF NOT EXISTS "holdCount"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MaterialInwardRegister" ADD COLUMN IF NOT EXISTS "qcRound"    INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "MaterialInwardRegister" ADD COLUMN IF NOT EXISTS "qcHistory"  JSONB;
