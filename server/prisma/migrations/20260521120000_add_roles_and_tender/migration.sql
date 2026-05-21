-- Add new Role enum values
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'METEOROLOGY';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'NDT';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'RND';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SAFETY';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'TENDER_MANAGER';

-- TenderStatus enum
DO $$ BEGIN
  CREATE TYPE "TenderStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'WON', 'LOST', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add recipientRole on InterOfficeNote
ALTER TABLE "InterOfficeNote" ADD COLUMN IF NOT EXISTS "recipientRole" TEXT DEFAULT 'LAB';

-- Tender table
CREATE TABLE IF NOT EXISTS "Tender" (
  "id"             TEXT NOT NULL,
  "tenderNumber"   TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "description"    TEXT,
  "clientName"     TEXT,
  "estimatedValue" DOUBLE PRECISION,
  "submissionDate" TIMESTAMP(3),
  "status"         "TenderStatus" NOT NULL DEFAULT 'ASSIGNED',
  "notes"          TEXT,
  "unitId"         TEXT NOT NULL,
  "createdById"    TEXT NOT NULL,
  "assignedToId"   TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Tender_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Tender_tenderNumber_key" ON "Tender"("tenderNumber");

ALTER TABLE "Tender"
  ADD CONSTRAINT "Tender_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Tender_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Tender_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
