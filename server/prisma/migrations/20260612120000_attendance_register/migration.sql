-- Attendance register
-- Unit-scoped monthly attendance maintained by each unit's manager.
-- Idempotent: safe to re-run.

-- ── AttendanceEmployee ──
CREATE TABLE IF NOT EXISTS "AttendanceEmployee" (
    "id"          TEXT NOT NULL,
    "unitId"      TEXT NOT NULL,
    "serialNo"    INTEGER NOT NULL,
    "name"        TEXT NOT NULL,
    "empCode"     TEXT,
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AttendanceEmployee_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceEmployee_unitId_serialNo_key"
    ON "AttendanceEmployee"("unitId", "serialNo");
CREATE INDEX IF NOT EXISTS "AttendanceEmployee_unitId_isActive_idx"
    ON "AttendanceEmployee"("unitId", "isActive");

DO $$ BEGIN
  ALTER TABLE "AttendanceEmployee" ADD CONSTRAINT "AttendanceEmployee_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AttendanceEmployee" ADD CONSTRAINT "AttendanceEmployee_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── AttendanceEntry ──
CREATE TABLE IF NOT EXISTS "AttendanceEntry" (
    "id"             TEXT NOT NULL,
    "employeeId"     TEXT NOT NULL,
    "date"           DATE NOT NULL,
    "inTime"         TEXT,
    "outTime"        TEXT,
    "statusCode"     TEXT,
    "firstSavedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedAt"     TIMESTAMP(3),
    "modifiedById"   TEXT,
    "modifiedByName" TEXT,
    "history"        JSONB,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AttendanceEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceEntry_employeeId_date_key"
    ON "AttendanceEntry"("employeeId", "date");
CREATE INDEX IF NOT EXISTS "AttendanceEntry_date_idx" ON "AttendanceEntry"("date");

DO $$ BEGIN
  ALTER TABLE "AttendanceEntry" ADD CONSTRAINT "AttendanceEntry_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "AttendanceEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── AttendanceMonthSubmission ──
CREATE TABLE IF NOT EXISTS "AttendanceMonthSubmission" (
    "id"            TEXT NOT NULL,
    "unitId"        TEXT NOT NULL,
    "year"          INTEGER NOT NULL,
    "month"         INTEGER NOT NULL,
    "submittedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedById" TEXT NOT NULL,
    CONSTRAINT "AttendanceMonthSubmission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceMonthSubmission_unitId_year_month_key"
    ON "AttendanceMonthSubmission"("unitId", "year", "month");
CREATE INDEX IF NOT EXISTS "AttendanceMonthSubmission_year_month_idx"
    ON "AttendanceMonthSubmission"("year", "month");

DO $$ BEGIN
  ALTER TABLE "AttendanceMonthSubmission" ADD CONSTRAINT "AttendanceMonthSubmission_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AttendanceMonthSubmission" ADD CONSTRAINT "AttendanceMonthSubmission_submittedById_fkey"
    FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
