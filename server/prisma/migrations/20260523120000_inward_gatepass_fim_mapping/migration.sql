-- ────────────────────────────────────────────────────────────
-- Inward Gate Pass support + FIM (Free Issue Material) mapping
-- - Add direction (INWARD/OUTWARD) to GatePass
-- - Capture customer's own gatepass details on INWARD
-- - Per-item inwardedQty tracking
-- - Link outward Delivery Challan items back to source INWARD item
-- - Link FIM ProductBatch back to source INWARD gatepass + item
-- ────────────────────────────────────────────────────────────

-- New direction enum
DO $$ BEGIN
  CREATE TYPE "GatePassDirection" AS ENUM ('INWARD', 'OUTWARD');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Extend GatePassStatus enum with INWARD-specific stages
ALTER TYPE "GatePassStatus" ADD VALUE IF NOT EXISTS 'PENDING_ACCEPTANCE';
ALTER TYPE "GatePassStatus" ADD VALUE IF NOT EXISTS 'ACCEPTED';

-- GatePass: direction + customer fields
ALTER TABLE "GatePass" ADD COLUMN IF NOT EXISTS "direction" "GatePassDirection" NOT NULL DEFAULT 'OUTWARD';
ALTER TABLE "GatePass" ADD COLUMN IF NOT EXISTS "customerName"         TEXT;
ALTER TABLE "GatePass" ADD COLUMN IF NOT EXISTS "customerGatePassNo"   TEXT;
ALTER TABLE "GatePass" ADD COLUMN IF NOT EXISTS "customerGatePassDate" TIMESTAMP(3);
ALTER TABLE "GatePass" ADD COLUMN IF NOT EXISTS "customerContact"      TEXT;

-- GatePassItem: per-item inward bookkeeping + outward→inward link
ALTER TABLE "GatePassItem" ADD COLUMN IF NOT EXISTS "inwardedQty" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "GatePassItem" ADD COLUMN IF NOT EXISTS "sourceInwardGatePassItemId" TEXT;

DO $$ BEGIN
  ALTER TABLE "GatePassItem"
    ADD CONSTRAINT "GatePassItem_sourceInwardGatePassItemId_fkey"
    FOREIGN KEY ("sourceInwardGatePassItemId") REFERENCES "GatePassItem"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "GatePassItem_sourceInwardGatePassItemId_idx"
  ON "GatePassItem" ("sourceInwardGatePassItemId");

-- ProductBatch: mark FIM and link to inward GatePass + item
ALTER TABLE "ProductBatch" ADD COLUMN IF NOT EXISTS "isFim" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProductBatch" ADD COLUMN IF NOT EXISTS "sourceInwardGatePassId" TEXT;
ALTER TABLE "ProductBatch" ADD COLUMN IF NOT EXISTS "sourceInwardGatePassItemId" TEXT;

DO $$ BEGIN
  ALTER TABLE "ProductBatch"
    ADD CONSTRAINT "ProductBatch_sourceInwardGatePassId_fkey"
    FOREIGN KEY ("sourceInwardGatePassId") REFERENCES "GatePass"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ProductBatch"
    ADD CONSTRAINT "ProductBatch_sourceInwardGatePassItemId_fkey"
    FOREIGN KEY ("sourceInwardGatePassItemId") REFERENCES "GatePassItem"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "ProductBatch_sourceInwardGatePassItemId_idx"
  ON "ProductBatch" ("sourceInwardGatePassItemId");
