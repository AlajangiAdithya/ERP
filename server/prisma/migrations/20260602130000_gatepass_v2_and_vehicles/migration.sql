-- Gate Pass v2: dual-flow Local Job / Outside, plus Vehicle register and SITE_OFFICE role.
-- INWARD/FIM flow is untouched.

-- 1) New role
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SITE_OFFICE';

-- 2) New status values
ALTER TYPE "GatePassStatus" ADD VALUE IF NOT EXISTS 'PENDING_STORE_REVIEW';
ALTER TYPE "GatePassStatus" ADD VALUE IF NOT EXISTS 'PENDING_LOGISTICS';
ALTER TYPE "GatePassStatus" ADD VALUE IF NOT EXISTS 'IN_TRANSIT';
ALTER TYPE "GatePassStatus" ADD VALUE IF NOT EXISTS 'PENDING_RETURN';

-- 3) GatePassKind enum
DO $$ BEGIN
  CREATE TYPE "GatePassKind" AS ENUM ('LOCAL_JOB', 'OUTSIDE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4) VehicleStatus enum
DO $$ BEGIN
  CREATE TYPE "VehicleStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'MAINTENANCE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5) Vehicle table
CREATE TABLE "Vehicle" (
  "id"              TEXT PRIMARY KEY,
  "regNumber"       TEXT NOT NULL,
  "vehicleType"     TEXT,
  "make"            TEXT,
  "model"           TEXT,
  "capacityKg"      DOUBLE PRECISION,
  "ownerType"       TEXT,
  "driverName"      TEXT,
  "driverPhone"     TEXT,
  "insuranceExpiry" TIMESTAMP(3),
  "pucExpiry"       TIMESTAMP(3),
  "fitnessExpiry"   TIMESTAMP(3),
  "rcUrl"           TEXT,
  "status"          "VehicleStatus" NOT NULL DEFAULT 'ACTIVE',
  "notes"           TEXT,
  "createdById"     TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "Vehicle_regNumber_key" ON "Vehicle"("regNumber");
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6) GatePass v2 columns
ALTER TABLE "GatePass"
  ADD COLUMN "kind"                 "GatePassKind",
  ADD COLUMN "jobWorkNo"            TEXT,
  ADD COLUMN "vendorDetails"        TEXT,
  ADD COLUMN "requestedById"        TEXT,
  ADD COLUMN "destinationOffice"    TEXT,
  ADD COLUMN "assignedVehicleId"    TEXT,
  ADD COLUMN "logisticsById"        TEXT,
  ADD COLUMN "logisticsAt"          TIMESTAMP(3),
  ADD COLUMN "dispatchedAt"         TIMESTAMP(3),
  ADD COLUMN "signedDeliveryPdfUrl" TEXT,
  ADD COLUMN "siteOfficeAckById"    TEXT,
  ADD COLUMN "siteOfficeAckAt"      TIMESTAMP(3),
  ADD COLUMN "reachedDate"          TIMESTAMP(3),
  ADD COLUMN "localReturnedAt"      TIMESTAMP(3),
  ADD COLUMN "localReturnedById"    TEXT;

ALTER TABLE "GatePass" ADD CONSTRAINT "GatePass_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GatePass" ADD CONSTRAINT "GatePass_assignedVehicleId_fkey"
  FOREIGN KEY ("assignedVehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GatePass" ADD CONSTRAINT "GatePass_logisticsById_fkey"
  FOREIGN KEY ("logisticsById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GatePass" ADD CONSTRAINT "GatePass_siteOfficeAckById_fkey"
  FOREIGN KEY ("siteOfficeAckById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GatePass" ADD CONSTRAINT "GatePass_localReturnedById_fkey"
  FOREIGN KEY ("localReturnedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "GatePass_assignedVehicleId_idx" ON "GatePass"("assignedVehicleId");
CREATE INDEX "GatePass_kind_idx" ON "GatePass"("kind");
