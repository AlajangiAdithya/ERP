-- Add SLA delay remark fields for approval turnaround tracking
-- WO: admin must explain if acceptance > 48h; unit manager if unit acceptance > 48h from admin acceptance
-- PR: admin must explain if approval > 48h
-- PO: purchase officer must explain if PO created > 4 days after PR adminApprovedAt

ALTER TABLE "WorkOrder"
  ADD COLUMN IF NOT EXISTS "adminDelayRemark" TEXT,
  ADD COLUMN IF NOT EXISTS "unitDelayRemark"  TEXT;

ALTER TABLE "PurchaseRequest"
  ADD COLUMN IF NOT EXISTS "adminDelayRemark" TEXT;

ALTER TABLE "PurchaseOrder"
  ADD COLUMN IF NOT EXISTS "poCreationDelayRemark" TEXT;
