-- A cash purchase can now carry several items (one register row each) that all
-- share a single MIR number, so MIR is no longer unique per row. Replace the
-- unique constraint with a plain index (still used for search / grouping).
DROP INDEX IF EXISTS "MaterialInwardRegister_mirNo_key";
CREATE INDEX IF NOT EXISTS "MaterialInwardRegister_mirNo_idx" ON "MaterialInwardRegister"("mirNo");

-- Product / material type captured at entry (Raw Material / Consumable /
-- Hand Tools & Fastners / Tools & Fixtures / Others).
ALTER TABLE "MaterialInwardRegister" ADD COLUMN IF NOT EXISTS "materialType" TEXT;
