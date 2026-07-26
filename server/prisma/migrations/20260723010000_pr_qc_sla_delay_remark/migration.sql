-- 48-hour SLA delay remark for the QC (first-level) approval of a purchase request.
-- Mandatory when QC approves more than 48h after the PR was raised (createdAt).
-- Written idempotently so it is safe to re-apply.

ALTER TABLE "PurchaseRequest" ADD COLUMN IF NOT EXISTS "qcDelayRemark" TEXT;
