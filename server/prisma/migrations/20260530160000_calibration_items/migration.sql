-- Metrology calibration items: pressure gauges, vacuum gauges, weighing
-- balances, testing equipment, metrology instruments, and MMR resources.
-- METROLOGY + ADMIN have write access; other procurement-chain roles read.

CREATE TYPE "CalibrationCategory" AS ENUM (
  'PRESSURE_GAUGE',
  'VACUUM_GAUGE',
  'WEIGHING_BALANCE',
  'TESTING_EQUIPMENT',
  'METROLOGY_INSTRUMENT',
  'MMR'
);

CREATE TABLE "CalibrationItem" (
  "id"                     TEXT NOT NULL,
  "category"               "CalibrationCategory" NOT NULL,
  "name"                   TEXT NOT NULL,
  "make"                   TEXT,
  "model"                  TEXT,
  "serialNo"               TEXT,
  "rapsplSerialNo"         TEXT,
  "operatingRange"         TEXT,
  "capacityMin"            TEXT,
  "capacityMax"            TEXT,
  "leastCount"             TEXT,
  "unitLocation"           TEXT,
  "usedFor"                TEXT,
  "calibrationOn"          TIMESTAMP(3),
  "calibrationDueDate"     TIMESTAMP(3),
  "recallDueDate"          TIMESTAMP(3),
  "calibrationCertificate" TEXT,
  "periodicity"            TEXT NOT NULL DEFAULT 'Every One Year',
  "notes"                  TEXT,
  "isActive"               BOOLEAN NOT NULL DEFAULT true,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CalibrationItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CalibrationItem_category_idx"     ON "CalibrationItem"("category");
CREATE INDEX "CalibrationItem_unitLocation_idx" ON "CalibrationItem"("unitLocation");
