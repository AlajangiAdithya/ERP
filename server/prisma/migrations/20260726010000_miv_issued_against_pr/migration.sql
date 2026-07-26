-- MIV → Purchase Request link.
-- Stores records which PR the material is being issued against at MIV clearance
-- (they type/pick the PR number only). Nullable: many MIVs draw general stock
-- with no PR behind them. ON DELETE SET NULL so removing a PR never cascades
-- into the MIVs that referenced it.
--
-- Written idempotently (IF NOT EXISTS / drop-if-exists) so it is safe to re-apply
-- on a database where the column was already created by an earlier `prisma db
-- push` — a plain ADD COLUMN fails there with 42701 and then blocks every later
-- migration. The drop-then-add on the FK also normalises a pre-existing
-- constraint to ON DELETE SET NULL.

ALTER TABLE "ProductRequest" ADD COLUMN IF NOT EXISTS "purchaseRequestId" TEXT;

CREATE INDEX IF NOT EXISTS "ProductRequest_purchaseRequestId_idx"
  ON "ProductRequest"("purchaseRequestId");

ALTER TABLE "ProductRequest"
  DROP CONSTRAINT IF EXISTS "ProductRequest_purchaseRequestId_fkey";
ALTER TABLE "ProductRequest"
  ADD CONSTRAINT "ProductRequest_purchaseRequestId_fkey"
  FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
