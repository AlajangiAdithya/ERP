-- ────────────────────────────────────────────────────────────
-- Phase 4 migration:
--  1. Consolidate NDT + METEROLOGY roles into LAB
--  2. Add InterOfficeNote / IONItem tables (ION system)
-- ────────────────────────────────────────────────────────────

-- Step 1: migrate any existing users off the removed enum values
UPDATE "User" SET "role" = 'LAB' WHERE "role"::text IN ('NDT', 'METEROLOGY');

-- Step 2: rebuild Role enum without NDT / METEROLOGY
ALTER TYPE "Role" RENAME TO "Role_old";
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MANAGER', 'STORE_MANAGER', 'PURCHASE_OFFICER', 'ACCOUNTING', 'QC', 'LAB');
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role" USING ("role"::text::"Role");
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'MANAGER';
DROP TYPE "Role_old";

-- Step 3: create IONStatus enum
CREATE TYPE "IONStatus" AS ENUM ('SENT', 'WAITING', 'COLLECTED');

-- Step 4: create InterOfficeNote table
CREATE TABLE "InterOfficeNote" (
    "id" TEXT NOT NULL,
    "ionNumber" TEXT NOT NULL,
    "userReferenceNo" TEXT,
    "section" TEXT,
    "projectName" TEXT,
    "supplyOrderNo" TEXT,
    "referenceDocQA" TEXT,
    "materialSupplyDate" TIMESTAMP(3),
    "sampleRequired" BOOLEAN NOT NULL DEFAULT false,
    "reportGeneration" BOOLEAN NOT NULL DEFAULT false,
    "requiredByDate" TIMESTAMP(3),
    "completedDate" TIMESTAMP(3),
    "externalQAWitness" TEXT,
    "qcContactDetails" TEXT,
    "otherInformation" TEXT,
    "status" "IONStatus" NOT NULL DEFAULT 'SENT',
    "createdById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterOfficeNote_pkey" PRIMARY KEY ("id")
);

-- Step 5: create IONItem table
CREATE TABLE "IONItem" (
    "id" TEXT NOT NULL,
    "ionId" TEXT NOT NULL,
    "jobIdentification" TEXT NOT NULL,
    "activityRequired" TEXT,
    "materialComposition" TEXT,
    "drawingNo" TEXT,
    "specification" TEXT,

    CONSTRAINT "IONItem_pkey" PRIMARY KEY ("id")
);

-- Step 6: indexes + FKs
CREATE UNIQUE INDEX "InterOfficeNote_ionNumber_key" ON "InterOfficeNote"("ionNumber");

ALTER TABLE "InterOfficeNote"
  ADD CONSTRAINT "InterOfficeNote_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InterOfficeNote"
  ADD CONSTRAINT "InterOfficeNote_assignedToId_fkey"
  FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "IONItem"
  ADD CONSTRAINT "IONItem_ionId_fkey"
  FOREIGN KEY ("ionId") REFERENCES "InterOfficeNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
