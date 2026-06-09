-- ────────────────────────────────────────────────────────────────────────────
-- WO workflow rework:
--   • SC declares lotsExpected on WO creation
--   • Finance enters invoice # + DC # manually (no file upload)
--   • Delivery ack requires two ack flags (invoice + DC) both true
--   • New WorkOrderAlarm + WorkOrderAlarmNote subsystem
--
-- NOTE: rewritten as idempotent on 2026-06-10 to recover from a partially
-- applied run (P3009). Every statement is safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

-- WO: declared lot count up-front
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "lotsExpected" INTEGER;

-- Closure: DC number + per-side ack flags
ALTER TABLE "WorkOrderClosure" ADD COLUMN IF NOT EXISTS "deliveryChallanNumber" TEXT;
ALTER TABLE "WorkOrderClosure" ADD COLUMN IF NOT EXISTS "invoiceAckReceived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WorkOrderClosure" ADD COLUMN IF NOT EXISTS "invoiceAckAt" TIMESTAMP(3);
ALTER TABLE "WorkOrderClosure" ADD COLUMN IF NOT EXISTS "dcAckReceived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WorkOrderClosure" ADD COLUMN IF NOT EXISTS "dcAckAt" TIMESTAMP(3);

-- Alarm enums (CREATE TYPE has no IF NOT EXISTS — guard with DO blocks)
DO $$ BEGIN
  CREATE TYPE "WorkOrderAlarmType" AS ENUM (
    'PDC_NEAR', 'PDC_OVERDUE', 'LOT_QC_PENDING', 'LOT_ON_HOLD',
    'SLA_BREACH_48H', 'PAYMENT_DUE_SOON', 'PAYMENT_OVERDUE', 'BG_EXPIRING'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "WorkOrderAlarmSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "WorkOrderAlarmStatus" AS ENUM ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Alarm table
CREATE TABLE IF NOT EXISTS "WorkOrderAlarm" (
  "id"               TEXT NOT NULL,
  "workOrderId"      TEXT NOT NULL,
  "closureId"        TEXT,
  "type"             "WorkOrderAlarmType" NOT NULL,
  "severity"         "WorkOrderAlarmSeverity" NOT NULL,
  "status"           "WorkOrderAlarmStatus" NOT NULL DEFAULT 'ACTIVE',
  "title"            TEXT NOT NULL,
  "triggerContext"   TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt"   TIMESTAMP(3),
  "acknowledgedById" TEXT,
  "ackRemark"        TEXT,
  "resolvedAt"       TIMESTAMP(3),
  "resolvedById"     TEXT,
  "resolveRemark"    TEXT,
  CONSTRAINT "WorkOrderAlarm_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WorkOrderAlarm_workOrderId_idx" ON "WorkOrderAlarm"("workOrderId");
CREATE INDEX IF NOT EXISTS "WorkOrderAlarm_status_idx"      ON "WorkOrderAlarm"("status");
CREATE INDEX IF NOT EXISTS "WorkOrderAlarm_type_idx"        ON "WorkOrderAlarm"("type");
CREATE UNIQUE INDEX IF NOT EXISTS "WorkOrderAlarm_workOrderId_closureId_type_status_key"
  ON "WorkOrderAlarm"("workOrderId", "closureId", "type", "status");

DO $$ BEGIN
  ALTER TABLE "WorkOrderAlarm" ADD CONSTRAINT "WorkOrderAlarm_workOrderId_fkey"
    FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "WorkOrderAlarm" ADD CONSTRAINT "WorkOrderAlarm_acknowledgedById_fkey"
    FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "WorkOrderAlarm" ADD CONSTRAINT "WorkOrderAlarm_resolvedById_fkey"
    FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Append-only notes thread per alarm
CREATE TABLE IF NOT EXISTS "WorkOrderAlarmNote" (
  "id"        TEXT NOT NULL,
  "alarmId"   TEXT NOT NULL,
  "authorId"  TEXT NOT NULL,
  "body"      TEXT NOT NULL,
  "kind"      TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkOrderAlarmNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WorkOrderAlarmNote_alarmId_idx" ON "WorkOrderAlarmNote"("alarmId");

DO $$ BEGIN
  ALTER TABLE "WorkOrderAlarmNote" ADD CONSTRAINT "WorkOrderAlarmNote_alarmId_fkey"
    FOREIGN KEY ("alarmId") REFERENCES "WorkOrderAlarm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "WorkOrderAlarmNote" ADD CONSTRAINT "WorkOrderAlarmNote_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
