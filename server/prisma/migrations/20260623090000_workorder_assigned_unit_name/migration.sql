-- Free-text unit/location from the source sheet (e.g. "SHAR", "CPDC-Rubber
-- Lining") when it doesn't match any Unit record. Shown in the UI in place of
-- "Unassigned" until a real unit is assigned.
ALTER TABLE "WorkOrder" ADD COLUMN "assignedUnitName" TEXT;
