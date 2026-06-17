-- Inward Inspection ION No. — auto-generated (RAPS/IION/<FY>/<N>) when Stores
-- sends a lot to QC. Additive & nullable; unique so the sequence never repeats
-- (Postgres allows multiple NULLs under a UNIQUE index, so existing rows are fine).

ALTER TABLE "MaterialInwardRegister" ADD COLUMN IF NOT EXISTS "ionNo" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "MaterialInwardRegister_ionNo_key"
  ON "MaterialInwardRegister" ("ionNo");
