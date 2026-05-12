-- ────────────────────────────────────────────────────────────
-- Gate Pass Request (RAMS/GPR/01) — multi-stage approval workflow
-- Adds: site, per-item form columns, approval trail, new statuses
-- ────────────────────────────────────────────────────────────

-- Extend GatePassStatus enum with workflow stages (keep OPEN for legacy rows)
ALTER TYPE "GatePassStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "GatePassStatus" ADD VALUE IF NOT EXISTS 'PENDING_STORE';
ALTER TYPE "GatePassStatus" ADD VALUE IF NOT EXISTS 'PENDING_ACCOUNTS';
ALTER TYPE "GatePassStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';
ALTER TYPE "GatePassStatus" ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE "GatePassStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

-- GatePass: relax passType, add site, approval trail
ALTER TABLE "GatePass" ALTER COLUMN "passType" DROP NOT NULL;
ALTER TABLE "GatePass" ADD COLUMN IF NOT EXISTS "siteName" TEXT;
ALTER TABLE "GatePass" ADD COLUMN IF NOT EXISTS "rejectedReason" TEXT;
ALTER TABLE "GatePass" ADD COLUMN IF NOT EXISTS "siteInchargeById" TEXT;
ALTER TABLE "GatePass" ADD COLUMN IF NOT EXISTS "siteInchargeAt" TIMESTAMP(3);
ALTER TABLE "GatePass" ADD COLUMN IF NOT EXISTS "storeInchargeById" TEXT;
ALTER TABLE "GatePass" ADD COLUMN IF NOT EXISTS "storeInchargeAt" TIMESTAMP(3);
ALTER TABLE "GatePass" ADD COLUMN IF NOT EXISTS "accountsById" TEXT;
ALTER TABLE "GatePass" ADD COLUMN IF NOT EXISTS "accountsAt" TIMESTAMP(3);
ALTER TABLE "GatePass" ADD COLUMN IF NOT EXISTS "approvedById" TEXT;
ALTER TABLE "GatePass" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);

ALTER TABLE "GatePass"
  ADD CONSTRAINT "GatePass_siteInchargeById_fkey"
  FOREIGN KEY ("siteInchargeById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GatePass"
  ADD CONSTRAINT "GatePass_storeInchargeById_fkey"
  FOREIGN KEY ("storeInchargeById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GatePass"
  ADD CONSTRAINT "GatePass_accountsById_fkey"
  FOREIGN KEY ("accountsById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GatePass"
  ADD CONSTRAINT "GatePass_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- GatePassItem: per-row form columns
ALTER TABLE "GatePassItem" ADD COLUMN IF NOT EXISTS "dispatchedTo" TEXT;
ALTER TABLE "GatePassItem" ADD COLUMN IF NOT EXISTS "itemPurpose" TEXT;
ALTER TABLE "GatePassItem" ADD COLUMN IF NOT EXISTS "probableReturnDate" TIMESTAMP(3);
ALTER TABLE "GatePassItem" ADD COLUMN IF NOT EXISTS "itemPassType" "GatePassType";
ALTER TABLE "GatePassItem" ADD COLUMN IF NOT EXISTS "gatePassDetails" TEXT;
ALTER TABLE "GatePassItem" ADD COLUMN IF NOT EXISTS "transportation" TEXT;
ALTER TABLE "GatePassItem" ADD COLUMN IF NOT EXISTS "contactPersonDetails" TEXT;
