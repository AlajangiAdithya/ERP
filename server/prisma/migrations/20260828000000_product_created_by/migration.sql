-- Master data authorship.
-- A purchase-request line may now only name a material that already exists in
-- Master Data, and ANY requester role (not just the Unit 1-5 managers) may add
-- one. So each entry has to record who added it: besides the Unit 1-5 managers,
-- that person is the one other user allowed to correct their own entry.
--
-- Left NULL on every pre-existing row -- those products were either created by
-- the master owners before this column existed, or auto-created by an old PR,
-- and have no identifiable author. A NULL author simply means "master owners
-- only" for the edit gate.
--
-- Every statement is written to be safely re-runnable. The start command runs
-- `prisma migrate deploy` on each boot and Railway restarts the container on
-- failure, so a migration that half-applies gets retried -- it must survive
-- landing on a database where some of its changes are already in place.

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "createdById" TEXT;

CREATE INDEX IF NOT EXISTS "Product_createdById_idx" ON "Product"("createdById");

-- Drop-then-add rather than a guard: re-adding an identical constraint is cheap
-- and this way the definition is applied exactly once, whatever state we found.
ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_createdById_fkey";

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
