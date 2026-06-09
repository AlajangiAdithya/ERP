-- Drop columns no longer used in the simplified gatepass workflow:
--  * vendorDetails (Local Job): no longer captured.
--  * destinationOffice (Outside): no longer captured.
-- Existing rows had these as nullable strings; dropping is safe.
ALTER TABLE "GatePass" DROP COLUMN IF EXISTS "vendorDetails";
ALTER TABLE "GatePass" DROP COLUMN IF EXISTS "destinationOffice";
