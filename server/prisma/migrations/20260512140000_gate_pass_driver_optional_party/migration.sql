-- Manager only fills the paper form (no global party field); Store Incharge
-- arranges the vehicle and supplies driver name + vehicle number on approval.

ALTER TABLE "GatePass" ALTER COLUMN "partyName" DROP NOT NULL;
ALTER TABLE "GatePass" ADD COLUMN IF NOT EXISTS "driverName" TEXT;
