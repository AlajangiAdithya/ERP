-- ────────────────────────────────────────────────────────────
-- Inward FIM flavors + unit-collected workflow
-- - inwardKind: STORES (existing, into product list) | DIRECT_TO_UNIT (no product-list step)
-- - destinationUnitId: for DIRECT_TO_UNIT, which unit's manager collects
-- - collectedAt / collectedById: unit-side collection acknowledgement
-- ────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "InwardKind" AS ENUM ('STORES', 'DIRECT_TO_UNIT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "GatePass" ADD COLUMN IF NOT EXISTS "inwardKind"        "InwardKind";
ALTER TABLE "GatePass" ADD COLUMN IF NOT EXISTS "destinationUnitId" TEXT;
ALTER TABLE "GatePass" ADD COLUMN IF NOT EXISTS "collectedAt"       TIMESTAMP(3);
ALTER TABLE "GatePass" ADD COLUMN IF NOT EXISTS "collectedById"     TEXT;

-- Backfill: existing inward rows are stores-bound.
UPDATE "GatePass" SET "inwardKind" = 'STORES'
WHERE "direction" = 'INWARD' AND "inwardKind" IS NULL;

DO $$ BEGIN
  ALTER TABLE "GatePass"
    ADD CONSTRAINT "GatePass_destinationUnitId_fkey"
    FOREIGN KEY ("destinationUnitId") REFERENCES "Unit"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "GatePass"
    ADD CONSTRAINT "GatePass_collectedById_fkey"
    FOREIGN KEY ("collectedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "GatePass_destinationUnitId_idx" ON "GatePass" ("destinationUnitId");
