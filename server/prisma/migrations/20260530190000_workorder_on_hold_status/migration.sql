-- Add ON_HOLD to WorkOrderStatus enum (idempotent).
-- ON_HOLD = unit rejected the WO; awaiting reassignment by SUPPLY_CHAIN/ADMIN.
DO $$ BEGIN
  ALTER TYPE "WorkOrderStatus" ADD VALUE IF NOT EXISTS 'ON_HOLD';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
