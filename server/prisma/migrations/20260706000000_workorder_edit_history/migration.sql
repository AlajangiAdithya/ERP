-- Work order edit history — field-level audit of every edit made to a work
-- order's core/scope details (customer, FIM, inspection agency, QAP, drawings,
-- tooling, packing, transportation, lots, dates …). Surfaced on the Work Order
-- detail modal. Captures who/when/role plus a JSON array of { field, label,
-- from, to } changes. Added so Supply Chain / Planning / Admin / the assigned
-- unit's manager can fill in scope information AFTER the WO is released while
-- every change stays fully traceable.

CREATE TABLE "WorkOrderEditHistory" (
  "id" TEXT NOT NULL,
  "workOrderId" TEXT NOT NULL,
  "changedById" TEXT,
  "changedByName" TEXT,
  "changedByRole" TEXT,
  "changes" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkOrderEditHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkOrderEditHistory_workOrderId_createdAt_idx"
  ON "WorkOrderEditHistory"("workOrderId", "createdAt");

ALTER TABLE "WorkOrderEditHistory"
  ADD CONSTRAINT "WorkOrderEditHistory_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
