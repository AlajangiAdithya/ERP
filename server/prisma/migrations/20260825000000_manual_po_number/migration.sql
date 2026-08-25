-- Manual PO numbering.
-- PO numbers are no longer generated when a quotation is approved: Purchase type
-- RAPS/PO/<FY>/<n> in themselves before the order can be placed. The column
-- therefore has to accept NULL for the "awaiting number" window. Postgres allows
-- any number of NULLs under a UNIQUE index, so the existing uniqueness guarantee
-- on real numbers is untouched.
--
-- Every statement here is written to be safely re-runnable. The start command
-- runs `prisma migrate deploy` on each boot and Railway restarts the container
-- on failure, so a migration that half-applies gets retried — it must survive
-- landing on a database where some of its changes are already in place.

-- No-op when the column is already nullable.
ALTER TABLE "PurchaseOrder" ALTER COLUMN "orderNumber" DROP NOT NULL;

-- Who typed the number in, and when. Left NULL on every pre-existing order --
-- those numbers were issued automatically and have no assigner.
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "numberAssignedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "numberAssignedById" TEXT;

-- Drop-then-add rather than a guard: re-adding an identical constraint is cheap
-- and this way the definition is applied exactly once, whatever state we found.
ALTER TABLE "PurchaseOrder"
  DROP CONSTRAINT IF EXISTS "PurchaseOrder_numberAssignedById_fkey";

ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_numberAssignedById_fkey"
  FOREIGN KEY ("numberAssignedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
