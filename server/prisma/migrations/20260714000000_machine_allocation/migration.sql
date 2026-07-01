-- Machine allocation / occupation system
-- Unit managers schedule Work Order / ION work onto machines; drives the daily
-- timeline calendar + monthly utilisation KPI. Allocating a manager-assigned ION
-- auto-advances it to WAITING (displayed as "In Progress").

-- New enums for allocation
DO $$ BEGIN
  CREATE TYPE "MachineAllocationSource" AS ENUM ('WORK_ORDER', 'ION');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "MachineAllocationStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "MachineDowntimeReason" AS ENUM ('MAINTENANCE', 'BREAKDOWN', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- MachineAllocation
CREATE TABLE IF NOT EXISTS "MachineAllocation" (
  "id"            TEXT NOT NULL,
  "machineryId"   TEXT NOT NULL,
  "sourceType"    "MachineAllocationSource" NOT NULL,
  "workOrderId"   TEXT,
  "ionId"         TEXT,
  "title"         TEXT,
  "scheduledDate" TIMESTAMP(3) NOT NULL,
  "startAt"       TIMESTAMP(3) NOT NULL,
  "endAt"         TIMESTAMP(3) NOT NULL,
  "status"        "MachineAllocationStatus" NOT NULL DEFAULT 'SCHEDULED',
  "workNote"      TEXT,
  "unitId"        TEXT,
  "allocatedById" TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MachineAllocation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MachineAllocation_machineryId_scheduledDate_idx" ON "MachineAllocation"("machineryId", "scheduledDate");
CREATE INDEX IF NOT EXISTS "MachineAllocation_scheduledDate_idx" ON "MachineAllocation"("scheduledDate");
CREATE INDEX IF NOT EXISTS "MachineAllocation_unitId_idx" ON "MachineAllocation"("unitId");

-- MachineDowntime
CREATE TABLE IF NOT EXISTS "MachineDowntime" (
  "id"            TEXT NOT NULL,
  "machineryId"   TEXT NOT NULL,
  "scheduledDate" TIMESTAMP(3) NOT NULL,
  "startAt"       TIMESTAMP(3) NOT NULL,
  "endAt"         TIMESTAMP(3) NOT NULL,
  "reason"        "MachineDowntimeReason" NOT NULL DEFAULT 'MAINTENANCE',
  "note"          TEXT,
  "unitId"        TEXT,
  "createdById"   TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MachineDowntime_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MachineDowntime_machineryId_scheduledDate_idx" ON "MachineDowntime"("machineryId", "scheduledDate");

-- Foreign keys
ALTER TABLE "MachineAllocation" ADD CONSTRAINT "MachineAllocation_machineryId_fkey"
  FOREIGN KEY ("machineryId") REFERENCES "Machinery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MachineAllocation" ADD CONSTRAINT "MachineAllocation_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MachineAllocation" ADD CONSTRAINT "MachineAllocation_ionId_fkey"
  FOREIGN KEY ("ionId") REFERENCES "InterOfficeNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MachineAllocation" ADD CONSTRAINT "MachineAllocation_unitId_fkey"
  FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MachineAllocation" ADD CONSTRAINT "MachineAllocation_allocatedById_fkey"
  FOREIGN KEY ("allocatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MachineDowntime" ADD CONSTRAINT "MachineDowntime_machineryId_fkey"
  FOREIGN KEY ("machineryId") REFERENCES "Machinery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MachineDowntime" ADD CONSTRAINT "MachineDowntime_unitId_fkey"
  FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MachineDowntime" ADD CONSTRAINT "MachineDowntime_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
