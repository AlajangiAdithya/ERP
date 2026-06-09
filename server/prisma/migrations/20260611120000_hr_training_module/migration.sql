-- HR / Training module
-- Adds:
--   * Role.HR value
--   * Employee + SkillMatrix
--   * TrainingPlan + TrainingPlanItem + TrainingSession + TrainingAttendee
-- Idempotent: safe to re-run.

-- ── Role enum: add HR ──
DO $$ BEGIN
  ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'HR';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Sub-enums ──
DO $$ BEGIN
  CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'INACTIVE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TrainingPlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TrainingItemStatus" AS ENUM ('PLANNED', 'SCHEDULED', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Employee ──
CREATE TABLE IF NOT EXISTS "Employee" (
    "id"            TEXT NOT NULL,
    "empCode"       TEXT NOT NULL,
    "serialNo"      INTEGER NOT NULL,
    "name"          TEXT NOT NULL,
    "designation"   TEXT,
    "qualification" TEXT,
    "experience"    INTEGER,
    "category"      TEXT,
    "department"    TEXT,
    "phone"         TEXT,
    "email"         TEXT,
    "dateOfJoining" TIMESTAMP(3),
    "status"        "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes"         TEXT,
    "userId"        TEXT,
    "createdById"   TEXT NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Employee_empCode_key" ON "Employee"("empCode");
CREATE UNIQUE INDEX IF NOT EXISTS "Employee_userId_key"  ON "Employee"("userId");
CREATE INDEX        IF NOT EXISTS "Employee_category_idx" ON "Employee"("category");
CREATE INDEX        IF NOT EXISTS "Employee_status_idx"   ON "Employee"("status");
CREATE INDEX        IF NOT EXISTS "Employee_serialNo_idx" ON "Employee"("serialNo");

DO $$ BEGIN
  ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Employee" ADD CONSTRAINT "Employee_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── SkillMatrix ──
CREATE TABLE IF NOT EXISTS "SkillMatrix" (
    "id"                     TEXT NOT NULL,
    "employeeId"             TEXT NOT NULL,
    "qmsAwareness"           DOUBLE PRECISION,
    "risksOpportunities"     DOUBLE PRECISION,
    "processKnowledge"       DOUBLE PRECISION,
    "inspectionTesting"      DOUBLE PRECISION,
    "qualityAnalytical"      DOUBLE PRECISION,
    "nonconformityAnalysis"  DOUBLE PRECISION,
    "customerRelations"      DOUBLE PRECISION,
    "supplierManagement"     DOUBLE PRECISION,
    "projectPlanning"        DOUBLE PRECISION,
    "equipmentMaintenance"   DOUBLE PRECISION,
    "materialInventory"      DOUBLE PRECISION,
    "internalAuditing"       DOUBLE PRECISION,
    "crisisManagement"       DOUBLE PRECISION,
    "communicationSkills"    DOUBLE PRECISION,
    "interPersonalRelations" DOUBLE PRECISION,
    "trainingNeeds"          TEXT,
    "remarks"                TEXT,
    "headOfDeptSig"          TEXT,
    "ratedOn"                TIMESTAMP(3),
    "updatedAt"              TIMESTAMP(3) NOT NULL,
    "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SkillMatrix_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SkillMatrix_employeeId_key" ON "SkillMatrix"("employeeId");

DO $$ BEGIN
  ALTER TABLE "SkillMatrix" ADD CONSTRAINT "SkillMatrix_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── TrainingPlan ──
CREATE TABLE IF NOT EXISTS "TrainingPlan" (
    "id"          TEXT NOT NULL,
    "fiscalYear"  TEXT NOT NULL,
    "title"       TEXT NOT NULL,
    "reference"   TEXT,
    "preparedBy"  TEXT,
    "approvedBy"  TEXT,
    "status"      "TrainingPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TrainingPlan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TrainingPlan_fiscalYear_key" ON "TrainingPlan"("fiscalYear");
CREATE INDEX        IF NOT EXISTS "TrainingPlan_status_idx"     ON "TrainingPlan"("status");

DO $$ BEGIN
  ALTER TABLE "TrainingPlan" ADD CONSTRAINT "TrainingPlan_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── TrainingPlanItem ──
CREATE TABLE IF NOT EXISTS "TrainingPlanItem" (
    "id"             TEXT NOT NULL,
    "planId"         TEXT NOT NULL,
    "serialNo"       INTEGER NOT NULL,
    "subject"        TEXT NOT NULL,
    "participants"   TEXT NOT NULL,
    "faculty"        TEXT,
    "scheduledMonth" TEXT,
    "actualMonth"    TEXT,
    "hoursPerMonth"  DOUBLE PRECISION,
    "remarks"        TEXT,
    "status"         "TrainingItemStatus" NOT NULL DEFAULT 'PLANNED',
    "unitId"         TEXT,
    "category"       TEXT,
    "createdById"    TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TrainingPlanItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TrainingPlanItem_planId_idx" ON "TrainingPlanItem"("planId");
CREATE INDEX IF NOT EXISTS "TrainingPlanItem_unitId_idx" ON "TrainingPlanItem"("unitId");
CREATE INDEX IF NOT EXISTS "TrainingPlanItem_status_idx" ON "TrainingPlanItem"("status");

DO $$ BEGIN
  ALTER TABLE "TrainingPlanItem" ADD CONSTRAINT "TrainingPlanItem_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "TrainingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TrainingPlanItem" ADD CONSTRAINT "TrainingPlanItem_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TrainingPlanItem" ADD CONSTRAINT "TrainingPlanItem_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── TrainingSession ──
CREATE TABLE IF NOT EXISTS "TrainingSession" (
    "id"               TEXT NOT NULL,
    "sessionNumber"    TEXT NOT NULL,
    "planId"           TEXT,
    "planItemId"       TEXT,
    "subject"          TEXT NOT NULL,
    "trainingDateFrom" TIMESTAMP(3) NOT NULL,
    "trainingDateTo"   TIMESTAMP(3),
    "duration"         TEXT,
    "place"            TEXT,
    "faculty"          TEXT NOT NULL,
    "facultySign"      TEXT,
    "reference"        TEXT,
    "trainingNotesUrl" TEXT,
    "evaluationUrl"    TEXT,
    "feedbackUrl"      TEXT,
    "notes"            TEXT,
    "createdById"      TEXT NOT NULL,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TrainingSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TrainingSession_sessionNumber_key" ON "TrainingSession"("sessionNumber");
CREATE INDEX        IF NOT EXISTS "TrainingSession_planId_idx"     ON "TrainingSession"("planId");
CREATE INDEX        IF NOT EXISTS "TrainingSession_planItemId_idx" ON "TrainingSession"("planItemId");
CREATE INDEX        IF NOT EXISTS "TrainingSession_trainingDateFrom_idx" ON "TrainingSession"("trainingDateFrom");

DO $$ BEGIN
  ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "TrainingPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_planItemId_fkey"
    FOREIGN KEY ("planItemId") REFERENCES "TrainingPlanItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── TrainingAttendee ──
CREATE TABLE IF NOT EXISTS "TrainingAttendee" (
    "id"                TEXT NOT NULL,
    "sessionId"         TEXT NOT NULL,
    "employeeId"        TEXT NOT NULL,
    "signUrl"           TEXT,
    "evaluationDetails" TEXT,
    "dateOfEvaluation"  TIMESTAMP(3),
    "evaluatedBy"       TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrainingAttendee_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TrainingAttendee_sessionId_employeeId_key"
  ON "TrainingAttendee"("sessionId", "employeeId");
CREATE INDEX IF NOT EXISTS "TrainingAttendee_employeeId_idx" ON "TrainingAttendee"("employeeId");

DO $$ BEGIN
  ALTER TABLE "TrainingAttendee" ADD CONSTRAINT "TrainingAttendee_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TrainingAttendee" ADD CONSTRAINT "TrainingAttendee_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
