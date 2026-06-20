-- PDC change history (append-only) for Work Orders.
--   • PDC extensions are unchanged (WorkOrderExtension already records who/when).
--   • This new table records DIRECT edits of the base WorkOrder.pdcDate so every
--     PDC change is visible: who changed it, when, from what date, to what, why.
--   • Permission widening (Planning + the assigned unit's Manager may now log /
--     edit PDC extensions) is enforced in application code — no schema change.

CREATE TABLE IF NOT EXISTS "WorkOrderPdcChange" (
  "id"          TEXT NOT NULL,
  "workOrderId" TEXT NOT NULL,
  "oldPdcDate"  TIMESTAMP(3),
  "newPdcDate"  TIMESTAMP(3),
  "reason"      TEXT,
  "changedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "changedById" TEXT,
  CONSTRAINT "WorkOrderPdcChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WorkOrderPdcChange_workOrderId_idx"
  ON "WorkOrderPdcChange"("workOrderId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkOrderPdcChange_workOrderId_fkey') THEN
    ALTER TABLE "WorkOrderPdcChange"
      ADD CONSTRAINT "WorkOrderPdcChange_workOrderId_fkey"
      FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkOrderPdcChange_changedById_fkey') THEN
    ALTER TABLE "WorkOrderPdcChange"
      ADD CONSTRAINT "WorkOrderPdcChange_changedById_fkey"
      FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
