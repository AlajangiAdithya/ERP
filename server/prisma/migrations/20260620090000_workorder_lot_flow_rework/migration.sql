-- ────────────────────────────────────────────────────────────────────────────
-- WO lot-flow rework:
--   • QC remark is mandatory and stored on the closure (qcRemark)
--   • Finance now has two separate buttons: "Invoice Sent" + "DC Sent".
--     dcSentAt/dcSentById added; 48h SLA starts when both are stamped.
--   • 3-month PDC alert now needs BOTH admin AND unit-manager remarks
--     (pdc3MonthMgrAck* fields added).
-- All statements idempotent — safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

-- Closure: QC remark + DC-sent stamp
ALTER TABLE "WorkOrderClosure" ADD COLUMN IF NOT EXISTS "qcRemark" TEXT;
ALTER TABLE "WorkOrderClosure" ADD COLUMN IF NOT EXISTS "dcSentAt" TIMESTAMP(3);
ALTER TABLE "WorkOrderClosure" ADD COLUMN IF NOT EXISTS "dcSentById" TEXT;

DO $$ BEGIN
  ALTER TABLE "WorkOrderClosure" ADD CONSTRAINT "WorkOrderClosure_dcSentById_fkey"
    FOREIGN KEY ("dcSentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- WO: unit-manager side of the 3-month PDC alert
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "pdc3MonthMgrAckAt" TIMESTAMP(3);
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "pdc3MonthMgrAckById" TEXT;
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "pdc3MonthMgrAckNote" TEXT;

DO $$ BEGIN
  ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_pdc3MonthMgrAckById_fkey"
    FOREIGN KEY ("pdc3MonthMgrAckById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Back-fill: old cycles already past finance keep their data; old cycles that
-- recorded an invoice+DC under the one-shot flow get dcSentAt = invoiceSentAt
-- so the new two-button logic sees them as fully dispatched.
UPDATE "WorkOrderClosure"
SET "dcSentAt" = "invoiceSentAt", "dcSentById" = "invoiceSentById"
WHERE "invoiceSentAt" IS NOT NULL AND "dcSentAt" IS NULL;
