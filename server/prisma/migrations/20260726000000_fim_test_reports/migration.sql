-- Customer test reports / material certificates attached to a FIM (INWARD gate
-- pass) entry at creation time. One row per file. "gatePassItemId" NULL means the
-- report covers the whole entry; set means it covers that single line.
-- Written idempotently (IF NOT EXISTS / drop-if-exists) so it is safe to re-apply.

CREATE TABLE IF NOT EXISTS "FimTestReport" (
  "id" TEXT NOT NULL,
  "gatePassId" TEXT NOT NULL,
  "gatePassItemId" TEXT,
  "url" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "mimeType" TEXT,
  "uploadedById" TEXT,
  "uploadedByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FimTestReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "FimTestReport_gatePassId_idx" ON "FimTestReport"("gatePassId");
CREATE INDEX IF NOT EXISTS "FimTestReport_gatePassItemId_idx" ON "FimTestReport"("gatePassItemId");

ALTER TABLE "FimTestReport" DROP CONSTRAINT IF EXISTS "FimTestReport_gatePassId_fkey";
ALTER TABLE "FimTestReport"
  ADD CONSTRAINT "FimTestReport_gatePassId_fkey"
  FOREIGN KEY ("gatePassId") REFERENCES "GatePass"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FimTestReport" DROP CONSTRAINT IF EXISTS "FimTestReport_gatePassItemId_fkey";
ALTER TABLE "FimTestReport"
  ADD CONSTRAINT "FimTestReport_gatePassItemId_fkey"
  FOREIGN KEY ("gatePassItemId") REFERENCES "GatePassItem"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
