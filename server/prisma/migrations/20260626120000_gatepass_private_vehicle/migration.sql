-- Logistics can dispatch a gate pass with a one-off hired/private vehicle that
-- isn't in the Vehicle register. We store the vehicle no + driver inline on the
-- gate pass (vehicleNo/driverName already exist), add a driver phone, and flag it
-- as private so dispatch is allowed without an assignedVehicleId. All additive.

ALTER TABLE "GatePass" ADD COLUMN IF NOT EXISTS "driverPhone"    TEXT;
ALTER TABLE "GatePass" ADD COLUMN IF NOT EXISTS "privateVehicle" BOOLEAN NOT NULL DEFAULT false;
