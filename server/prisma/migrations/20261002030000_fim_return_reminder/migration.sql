-- Marker for the daily FIM return-due reminder (jobs/fimReturns.js) so the
-- concerned unit managers / Stores are nudged once a day per batch, not once per
-- cron tick.
ALTER TABLE "ProductBatch"
  ADD COLUMN IF NOT EXISTS "fimReturnReminderAt" TIMESTAMP(3);
