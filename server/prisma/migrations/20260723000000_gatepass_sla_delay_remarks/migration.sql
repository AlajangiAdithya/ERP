-- 48-hour SLA delay remarks for gate pass approval stages.
-- Mandatory when a stage is actioned more than 48h after it became pending:
--   • storeDelayRemark    — Stores approval given >48h after the pass was raised.
--   • accountsDelayRemark — Accounts approval/invoice given >48h after it reached Accounts.
-- Written idempotently so it is safe to re-apply.

ALTER TABLE "GatePass" ADD COLUMN IF NOT EXISTS "storeDelayRemark" TEXT;
ALTER TABLE "GatePass" ADD COLUMN IF NOT EXISTS "accountsDelayRemark" TEXT;
