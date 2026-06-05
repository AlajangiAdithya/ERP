-- ────────────────────────────────────────────────────────────────────────────
-- WO workflow rework:
--   • SC declares lotsExpected on WO creation
--   • Finance enters invoice # + DC # manually (no file upload)
--   • Delivery ack requires two ack flags (invoice + DC) both true
--   • New WorkOrderAlarm + WorkOrderAlarmNote subsystem
-- ────────────────────────────────────────────────────────────────────────────

-- WO: declared lot count up-front
ALTER TABLE "WorkOrder" ADD COLUMN "lotsExpected" INTEGER;

-- Closure: DC number + per-side ack flags
ALTER TABLE "WorkOrderClosure" ADD COLUMN "deliveryChallanNumber" TEXT;
ALTER TABLE "WorkOrderClosure" ADD COLUMN "invoiceAckReceived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WorkOrderClosure" ADD COLUMN "invoiceAckAt" TIMESTAMP(3);
ALTER TABLE "WorkOrderClosure" ADD COLUMN "dcAckReceived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WorkOrderClosure" ADD COLUMN "dcAckAt" TIMESTAMP(3);

-- Alarm enums
CREATE TYPE "WorkOrderAlarmType" AS ENUM (
  'PDC_NEAR', 'PDC_OVERDUE', 'LOT_QC_PENDING', 'LOT_ON_HOLD',
  'SLA_BREACH_48H', 'PAYMENT_DUE_SOON', 'PAYMENT_OVERDUE', 'BG_EXPIRING'
);
CREATE TYPE "WorkOrderAlarmSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
CREATE TYPE "WorkOrderAlarmStatus" AS ENUM ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED');

-- Alarm table
CREATE TABLE "WorkOrderAlarm" (
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
CREATE INDEX "WorkOrderAlarm_workOrderId_idx" ON "WorkOrderAlarm"("workOrderId");
CREATE INDEX "WorkOrderAlarm_status_idx" ON "WorkOrderAlarm"("status");
CREATE INDEX "WorkOrderAlarm_type_idx" ON "WorkOrderAlarm"("type");
CREATE UNIQUE INDEX "WorkOrderAlarm_workOrderId_closureId_type_status_key"
  ON "WorkOrderAlarm"("workOrderId", "closureId", "type", "status");

ALTER TABLE "WorkOrderAlarm" ADD CONSTRAINT "WorkOrderAlarm_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkOrderAlarm" ADD CONSTRAINT "WorkOrderAlarm_acknowledgedById_fkey"
  FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkOrderAlarm" ADD CONSTRAINT "WorkOrderAlarm_resolvedById_fkey"
  FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Append-only notes thread per alarm
CREATE TABLE "WorkOrderAlarmNote" (
  "id"        TEXT NOT NULL,
  "alarmId"   TEXT NOT NULL,
  "authorId"  TEXT NOT NULL,
  "body"      TEXT NOT NULL,
  "kind"      TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkOrderAlarmNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WorkOrderAlarmNote_alarmId_idx" ON "WorkOrderAlarmNote"("alarmId");

ALTER TABLE "WorkOrderAlarmNote" ADD CONSTRAINT "WorkOrderAlarmNote_alarmId_fkey"
  FOREIGN KEY ("alarmId") REFERENCES "WorkOrderAlarm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkOrderAlarmNote" ADD CONSTRAINT "WorkOrderAlarmNote_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
