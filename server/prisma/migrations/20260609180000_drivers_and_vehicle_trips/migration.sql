-- Drivers + Vehicle trips (multi-gatepass dispatches + ad-hoc movements)

-- ── Enums ──
CREATE TYPE "DriverStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "TripStatus" AS ENUM ('SCHEDULED', 'IN_TRANSIT', 'RETURNED', 'CANCELLED');

-- ── Driver register ──
CREATE TABLE "Driver" (
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

CREATE UNIQUE INDEX "Driver_licenseNo_key" ON "Driver"("licenseNo");
CREATE INDEX "Driver_defaultVehicleId_idx" ON "Driver"("defaultVehicleId");

ALTER TABLE "Driver" ADD CONSTRAINT "Driver_defaultVehicleId_fkey"
    FOREIGN KEY ("defaultVehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Vehicle trips ──
CREATE TABLE "VehicleTrip" (
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

CREATE UNIQUE INDEX "VehicleTrip_tripNumber_key" ON "VehicleTrip"("tripNumber");
CREATE INDEX "VehicleTrip_vehicleId_idx" ON "VehicleTrip"("vehicleId");
CREATE INDEX "VehicleTrip_driverId_idx" ON "VehicleTrip"("driverId");
CREATE INDEX "VehicleTrip_status_idx" ON "VehicleTrip"("status");

ALTER TABLE "VehicleTrip" ADD CONSTRAINT "VehicleTrip_vehicleId_fkey"
    FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VehicleTrip" ADD CONSTRAINT "VehicleTrip_driverId_fkey"
    FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VehicleTrip" ADD CONSTRAINT "VehicleTrip_dispatchedById_fkey"
    FOREIGN KEY ("dispatchedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VehicleTrip" ADD CONSTRAINT "VehicleTrip_returnedById_fkey"
    FOREIGN KEY ("returnedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VehicleTrip" ADD CONSTRAINT "VehicleTrip_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── GatePass: add assignedDriverId + tripId ──
ALTER TABLE "GatePass"
    ADD COLUMN "assignedDriverId" TEXT,
    ADD COLUMN "tripId" TEXT;

CREATE INDEX "GatePass_assignedDriverId_idx" ON "GatePass"("assignedDriverId");
CREATE INDEX "GatePass_tripId_idx" ON "GatePass"("tripId");

ALTER TABLE "GatePass" ADD CONSTRAINT "GatePass_assignedDriverId_fkey"
    FOREIGN KEY ("assignedDriverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GatePass" ADD CONSTRAINT "GatePass_tripId_fkey"
    FOREIGN KEY ("tripId") REFERENCES "VehicleTrip"("id") ON DELETE SET NULL ON UPDATE CASCADE;
