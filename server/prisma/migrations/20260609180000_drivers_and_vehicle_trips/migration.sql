-- Drivers + Vehicle trips (multi-gatepass dispatches + ad-hoc movements)
-- Idempotent: every statement is safe to re-run after a partial earlier apply.

-- ── Enums ──
DO $$ BEGIN
  CREATE TYPE "DriverStatus" AS ENUM ('ACTIVE', 'INACTIVE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TripStatus" AS ENUM ('SCHEDULED', 'IN_TRANSIT', 'RETURNED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Driver register ──
CREATE TABLE IF NOT EXISTS "Driver" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "licenseNo" TEXT,
    "licenseExpiry" TIMESTAMP(3),
    "defaultVehicleId" TEXT,
    "status" "DriverStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Driver_licenseNo_key"        ON "Driver"("licenseNo");
CREATE INDEX        IF NOT EXISTS "Driver_defaultVehicleId_idx" ON "Driver"("defaultVehicleId");

DO $$ BEGIN
  ALTER TABLE "Driver" ADD CONSTRAINT "Driver_defaultVehicleId_fkey"
    FOREIGN KEY ("defaultVehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Driver" ADD CONSTRAINT "Driver_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Vehicle trips ──
CREATE TABLE IF NOT EXISTS "VehicleTrip" (
    "id" TEXT NOT NULL,
    "tripNumber" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "driverId" TEXT,
    "driverNameSnap" TEXT,
    "driverPhoneSnap" TEXT,
    "vehicleRegSnap" TEXT,
    "purpose" TEXT,
    "destination" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "dispatchedById" TEXT,
    "returnedAt" TIMESTAMP(3),
    "returnedById" TEXT,
    "status" "TripStatus" NOT NULL DEFAULT 'SCHEDULED',
    "remarks" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VehicleTrip_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "VehicleTrip_tripNumber_key" ON "VehicleTrip"("tripNumber");
CREATE INDEX        IF NOT EXISTS "VehicleTrip_vehicleId_idx"  ON "VehicleTrip"("vehicleId");
CREATE INDEX        IF NOT EXISTS "VehicleTrip_driverId_idx"   ON "VehicleTrip"("driverId");
CREATE INDEX        IF NOT EXISTS "VehicleTrip_status_idx"     ON "VehicleTrip"("status");

DO $$ BEGIN
  ALTER TABLE "VehicleTrip" ADD CONSTRAINT "VehicleTrip_vehicleId_fkey"
    FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "VehicleTrip" ADD CONSTRAINT "VehicleTrip_driverId_fkey"
    FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "VehicleTrip" ADD CONSTRAINT "VehicleTrip_dispatchedById_fkey"
    FOREIGN KEY ("dispatchedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "VehicleTrip" ADD CONSTRAINT "VehicleTrip_returnedById_fkey"
    FOREIGN KEY ("returnedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "VehicleTrip" ADD CONSTRAINT "VehicleTrip_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── GatePass: add assignedDriverId + tripId ──
ALTER TABLE "GatePass" ADD COLUMN IF NOT EXISTS "assignedDriverId" TEXT;
ALTER TABLE "GatePass" ADD COLUMN IF NOT EXISTS "tripId" TEXT;

CREATE INDEX IF NOT EXISTS "GatePass_assignedDriverId_idx" ON "GatePass"("assignedDriverId");
CREATE INDEX IF NOT EXISTS "GatePass_tripId_idx"           ON "GatePass"("tripId");

DO $$ BEGIN
  ALTER TABLE "GatePass" ADD CONSTRAINT "GatePass_assignedDriverId_fkey"
    FOREIGN KEY ("assignedDriverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "GatePass" ADD CONSTRAINT "GatePass_tripId_fkey"
    FOREIGN KEY ("tripId") REFERENCES "VehicleTrip"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
