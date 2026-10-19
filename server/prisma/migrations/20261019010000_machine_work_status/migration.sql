-- Working machine status: the daily ON/OFF log units already keep on paper and
-- in "WORKING MACHINE STATUS FILE.xlsx". One row per machine per day.

-- ── Machinery.unitId ──────────────────────────────────────────────────────
-- `place` is the free-text label people type and print ("Unit-5",
-- "Unit-2 QC Lab", "Unit-1 (NDT)"). Work-status edit rights are scoped to a
-- manager's own unit, and matching that free text at request time cannot be
-- trusted, so resolve it once into a real relation.
ALTER TABLE "Machinery" ADD COLUMN IF NOT EXISTS "unitId" TEXT;

-- Backfill: pull the leading unit token out of `place` and match it to
-- Unit.code. The regex takes digits plus an optional letter, so "Unit-1A"
-- gives '1A' while "Unit-2 QC Lab" and "Unit-1 (NDT)" give '2' and '1'.
-- Machines with no `place` stay null and land in an Unassigned group.
--
-- Both sides are stripped of punctuation before comparing because Unit.code is
-- not written the same way everywhere: production stores 'UNIT-1' / 'UNIT-1A'
-- while the dev seed stores bare '1' / '1A'. Matching the raw token against the
-- raw code silently updates nothing on production, so accept either spelling.
UPDATE "Machinery" m
SET "unitId" = u.id
FROM "Unit" u
WHERE m."place" IS NOT NULL
  AND m."unitId" IS NULL
  AND substring(m."place" from '^[Uu]nit[-\s]*([0-9]+[A-Za-z]?)') IS NOT NULL
  AND upper(regexp_replace(u."code", '[^A-Za-z0-9]', '', 'g')) IN (
        'UNIT' || upper(substring(m."place" from '^[Uu]nit[-\s]*([0-9]+[A-Za-z]?)')),
        upper(substring(m."place" from '^[Uu]nit[-\s]*([0-9]+[A-Za-z]?)'))
      );

CREATE INDEX IF NOT EXISTS "Machinery_unitId_idx" ON "Machinery" ("unitId");

ALTER TABLE "Machinery"
  DROP CONSTRAINT IF EXISTS "Machinery_unitId_fkey";
ALTER TABLE "Machinery"
  ADD CONSTRAINT "Machinery_unitId_fkey" FOREIGN KEY ("unitId")
  REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── MachineWorkStatus ─────────────────────────────────────────────────────
-- onMinutes / offMinutes are minutes from midnight (0..1439), not timestamps.
-- The form records a wall-clock shift time against a date that is already its
-- own column, so an instant would invent a timezone nobody supplied. An
-- integer keeps that property while making the hours arithmetic exact -
-- summing hours out of free text ("9:00" / "09:00 AM" / "9am") silently drops
-- rows from the total.
--
-- runMinutes is derived on write and stored, so the month and year roll-ups
-- are a plain SUM the planner answers from the (machineryId, logDate) index
-- instead of recomputing per row on every read.
CREATE TABLE IF NOT EXISTS "MachineWorkStatus" (
    "id" TEXT NOT NULL,
    "machineryId" TEXT NOT NULL,
    "unitId" TEXT,
    "logDate" DATE NOT NULL,
    "work" TEXT,
    "onPerson" TEXT,
    "offPerson" TEXT,
    "onMinutes" INTEGER,
    "offMinutes" INTEGER,
    "runMinutes" INTEGER,
    "remarks" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MachineWorkStatus_pkey" PRIMARY KEY ("id")
);

-- One row per machine per day. The grid upserts on this pair, so it is the
-- thing that keeps a double-submit from creating two rows for one day.
CREATE UNIQUE INDEX IF NOT EXISTS "MachineWorkStatus_machineryId_logDate_key"
  ON "MachineWorkStatus" ("machineryId", "logDate");

CREATE INDEX IF NOT EXISTS "MachineWorkStatus_machineryId_logDate_idx"
  ON "MachineWorkStatus" ("machineryId", "logDate");

CREATE INDEX IF NOT EXISTS "MachineWorkStatus_unitId_logDate_idx"
  ON "MachineWorkStatus" ("unitId", "logDate");

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so every constraint is dropped
-- first. Without this a part-applied run leaves the migration unrepeatable:
-- the table and indexes survive, the first FK survives, and the retry dies on
-- "constraint already exists" with the migration stuck in a failed state.
ALTER TABLE "MachineWorkStatus"
  DROP CONSTRAINT IF EXISTS "MachineWorkStatus_machineryId_fkey";
ALTER TABLE "MachineWorkStatus"
  ADD CONSTRAINT "MachineWorkStatus_machineryId_fkey" FOREIGN KEY ("machineryId")
  REFERENCES "Machinery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MachineWorkStatus"
  DROP CONSTRAINT IF EXISTS "MachineWorkStatus_unitId_fkey";
ALTER TABLE "MachineWorkStatus"
  ADD CONSTRAINT "MachineWorkStatus_unitId_fkey" FOREIGN KEY ("unitId")
  REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MachineWorkStatus"
  DROP CONSTRAINT IF EXISTS "MachineWorkStatus_createdById_fkey";
ALTER TABLE "MachineWorkStatus"
  ADD CONSTRAINT "MachineWorkStatus_createdById_fkey" FOREIGN KEY ("createdById")
  REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MachineWorkStatus"
  DROP CONSTRAINT IF EXISTS "MachineWorkStatus_updatedById_fkey";
ALTER TABLE "MachineWorkStatus"
  ADD CONSTRAINT "MachineWorkStatus_updatedById_fkey" FOREIGN KEY ("updatedById")
  REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
