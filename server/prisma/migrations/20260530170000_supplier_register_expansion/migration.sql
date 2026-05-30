-- Supplier register expansion: Approved Supplier List columns + structured
-- assessment, re-evaluation, and performance rating tables. Lets Purchase
-- Officer maintain the printable forms in the system instead of attaching PDFs.
--
-- This migration is written defensively (IF NOT EXISTS + exception-swallowing
-- DO blocks for CREATE TYPE) because the production DB has been touched by
-- `prisma db push` historically, so individual objects may already exist.

-- ── Enums ───────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "SupplierMaterialType" AS ENUM ('MATERIAL', 'JOB_WORK', 'SERVICE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SupplierApprovalStatus" AS ENUM ('APPROVED', 'CONDITIONAL', 'REJECTED', 'TERMINATED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SupplierReEvalDecision" AS ENUM ('CONTINUES', 'TERMINATED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SupplierBusinessType" AS ENUM ('PROPRIETORSHIP', 'PARTNERSHIP', 'PRIVATE_LTD', 'PUBLIC_LTD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SupplierBusinessRole" AS ENUM ('MANUFACTURER', 'SUPPLIER', 'DEALER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Supplier: new approved-list columns ─────────────────────────────────
ALTER TABLE "Supplier"
  ADD COLUMN IF NOT EXISTS "vendorIdNo"             TEXT,
  ADD COLUMN IF NOT EXISTS "contactPerson"          TEXT,
  ADD COLUMN IF NOT EXISTS "contactPhone"           TEXT,
  ADD COLUMN IF NOT EXISTS "scopeOfSupply"          TEXT,
  ADD COLUMN IF NOT EXISTS "materialType"           "SupplierMaterialType",
  ADD COLUMN IF NOT EXISTS "approvalStatus"         "SupplierApprovalStatus",
  ADD COLUMN IF NOT EXISTS "approvalDate"           TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "typeAndExtentOfControl" TEXT,
  ADD COLUMN IF NOT EXISTS "remarks"                TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Supplier_vendorIdNo_key" ON "Supplier"("vendorIdNo");

-- ── Re-evaluation log ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "SupplierReEvaluation" (
  "id"                          TEXT NOT NULL,
  "supplierId"                  TEXT NOT NULL,
  "financialYear"               TEXT NOT NULL,
  "initialEvaluationDate"       TIMESTAMP(3),
  "initialEvaluationScope"      TEXT,
  "noOrders6Months"             BOOLEAN,
  "noOrdersReason"              TEXT,
  "managementChanged"           BOOLEAN,
  "newMgmtContinuingTerms"      BOOLEAN,
  "shiftedLocation"             BOOLEAN,
  "newAddress"                  TEXT,
  "performanceBelowPar"         BOOLEAN,
  "correctiveActionInitiated"   TEXT,
  "recommendedTermination"      BOOLEAN,
  "correctiveActionEffective"   BOOLEAN,
  "noNonconformitiesReported"   BOOLEAN,
  "newMachinesAdded"            BOOLEAN,
  "wishToContinueForNewParts"   BOOLEAN,
  "isoCertified"                BOOLEAN,
  "overallDecision"             "SupplierReEvalDecision" NOT NULL DEFAULT 'CONTINUES',
  "evaluationDate"              TIMESTAMP(3),
  "nextReviewDate"              TIMESTAMP(3),
  "performanceRating"           DOUBLE PRECISION,
  "remarks"                     TEXT,
  "evaluatedByUserId"           TEXT,
  "evaluatedByName"             TEXT,
  "createdAt"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplierReEvaluation_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "SupplierReEvaluation"
    ADD CONSTRAINT "SupplierReEvaluation_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "SupplierReEvaluation_supplierId_idx"               ON "SupplierReEvaluation"("supplierId");
CREATE INDEX IF NOT EXISTS "SupplierReEvaluation_supplierId_financialYear_idx" ON "SupplierReEvaluation"("supplierId", "financialYear");

-- ── Structured assessment form ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "SupplierAssessmentForm" (
  "id"                        TEXT NOT NULL,
  "supplierId"                TEXT NOT NULL,
  "financialYear"             TEXT NOT NULL,
  "companyName"               TEXT,
  "companyAddress"            TEXT,
  "businessType"              "SupplierBusinessType",
  "businessRole"              "SupplierBusinessRole",
  "productsRange"             TEXT,
  "machineryAndEquipment"     TEXT,
  "majorCustomers"            TEXT,
  "transportFacilities"       TEXT,
  "deliveryPeriod"            TEXT,
  "allowsCapabilityVerify"    BOOLEAN,
  "hasQualityControlSystem"   BOOLEAN,
  "isoCertified"              BOOLEAN,
  "isoCertificateUrl"         TEXT,
  "testCertWithDelivery"      BOOLEAN,
  "readyToUpgradePerformance" BOOLEAN,
  "reviewComments"            TEXT,
  "reviewedByName"            TEXT,
  "reviewedByUserId"          TEXT,
  "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                 TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplierAssessmentForm_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "SupplierAssessmentForm"
    ADD CONSTRAINT "SupplierAssessmentForm_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "SupplierAssessmentForm_supplierId_idx"               ON "SupplierAssessmentForm"("supplierId");
CREATE INDEX IF NOT EXISTS "SupplierAssessmentForm_supplierId_financialYear_idx" ON "SupplierAssessmentForm"("supplierId", "financialYear");

-- ── Performance rating (header + items) ────────────────────────────────
CREATE TABLE IF NOT EXISTS "SupplierPerformanceRating" (
  "id"               TEXT NOT NULL,
  "financialYear"    TEXT NOT NULL,
  "periodFrom"       TIMESTAMP(3),
  "periodTo"         TIMESTAMP(3),
  "preparedDate"     TIMESTAMP(3),
  "preparedByName"   TEXT,
  "preparedByUserId" TEXT,
  "minimumCriteria"  DOUBLE PRECISION NOT NULL DEFAULT 85,
  "overallRating"    DOUBLE PRECISION,
  "remarks"          TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplierPerformanceRating_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SupplierPerformanceRating_financialYear_key" ON "SupplierPerformanceRating"("financialYear");
CREATE INDEX        IF NOT EXISTS "SupplierPerformanceRating_financialYear_idx" ON "SupplierPerformanceRating"("financialYear");

CREATE TABLE IF NOT EXISTS "SupplierPerformanceRatingItem" (
  "id"                TEXT NOT NULL,
  "ratingId"          TEXT NOT NULL,
  "supplierId"        TEXT,
  "itemDescription"   TEXT NOT NULL,
  "supplierName"      TEXT NOT NULL,
  "suppliesReceived"  INTEGER NOT NULL DEFAULT 0,
  "qtyAccepted"       INTEGER NOT NULL DEFAULT 0,
  "qualityRating"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalDeliveries"   INTEGER NOT NULL DEFAULT 0,
  "deliveriesOnTime"  INTEGER NOT NULL DEFAULT 0,
  "deliveriesLate"    INTEGER NOT NULL DEFAULT 0,
  "deliveryRating"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalRating"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierPerformanceRatingItem_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "SupplierPerformanceRatingItem"
    ADD CONSTRAINT "SupplierPerformanceRatingItem_ratingId_fkey"
    FOREIGN KEY ("ratingId") REFERENCES "SupplierPerformanceRating"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SupplierPerformanceRatingItem"
    ADD CONSTRAINT "SupplierPerformanceRatingItem_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "SupplierPerformanceRatingItem_ratingId_idx"   ON "SupplierPerformanceRatingItem"("ratingId");
CREATE INDEX IF NOT EXISTS "SupplierPerformanceRatingItem_supplierId_idx" ON "SupplierPerformanceRatingItem"("supplierId");
