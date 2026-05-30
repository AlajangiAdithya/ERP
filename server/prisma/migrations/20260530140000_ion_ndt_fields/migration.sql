-- NDT-specific ION fields (Doc No RAPS/ION-7). All nullable so existing
-- LAB/METROLOGY/cross-unit-MANAGER ions keep working unchanged.

ALTER TABLE "InterOfficeNote"
  ADD COLUMN "reportNoAndDate" TEXT;

ALTER TABLE "IONItem"
  ADD COLUMN "nameOfJob"   TEXT,
  ADD COLUMN "qty"         TEXT,
  ADD COLUMN "itemRemarks" TEXT,
  ADD COLUMN "ndtDetails"  JSONB;
