-- Extends CalibrationItem with MIR header + remarks + MMR sub-category bucket,
-- and adds a per-fiscal-year CalibrationRecord child table so the register can
-- render FY 26-27 / FY 27-28 columns side-by-side with their own certificates.

CREATE TYPE "MmrSubCategory" AS ENUM (
  'PRESSURE_GAUGES',
  'VACUUM_GAUGES',
  'METROLOGY_INSTRUMENTS',
  'LAB_TESTING_EQUIPMENT',
  'AUTOCLAVE_OVEN_THERMOCOUPLES',
  'EOT_CRANES_CHAIN_BLOCKS',
  'OTHER'
);

ALTER TABLE "CalibrationItem"
  ADD COLUMN "mmrSubCategory" "MmrSubCategory",
  ADD COLUMN "mirNo"          TEXT,
  ADD COLUMN "mirDate"        TIMESTAMP(3),
  ADD COLUMN "remarks"        TEXT;

CREATE INDEX "CalibrationItem_mmrSubCategory_idx" ON "CalibrationItem"("mmrSubCategory");

CREATE TABLE "CalibrationRecord" (
  "id"                    TEXT NOT NULL,
  "itemId"                TEXT NOT NULL,
  "fiscalYear"            TEXT NOT NULL,
  "qcVerifiedBy"          TEXT,
  "verifiedOn"            TIMESTAMP(3),
  "certificateNo"         TEXT,
  "certificateAttachment" TEXT,
  "calibratedOn"          TIMESTAMP(3),
  "dueDate"               TIMESTAMP(3),
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CalibrationRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CalibrationRecord_itemId_fiscalYear_key" ON "CalibrationRecord"("itemId", "fiscalYear");
CREATE INDEX "CalibrationRecord_itemId_idx" ON "CalibrationRecord"("itemId");

ALTER TABLE "CalibrationRecord"
  ADD CONSTRAINT "CalibrationRecord_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "CalibrationItem"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
