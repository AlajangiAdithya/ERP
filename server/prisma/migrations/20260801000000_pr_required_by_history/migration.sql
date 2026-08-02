-- Audit trail for required-by date changes on a purchase request. One row per PR
-- line whose date actually moved: who changed it, when, the old value and the new
-- one, plus the PR status at that moment.
--
-- "itemId" is intentionally NOT a foreign key — PUT /purchase-requests/:id deletes
-- and recreates item rows while a PR is still pending, and the history has to
-- outlive that. "productName" is a snapshot for the same reason.
-- Written idempotently (IF NOT EXISTS / drop-if-exists) so it is safe to re-apply.

CREATE TABLE IF NOT EXISTS "PurchaseRequestDateHistory" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "itemId" TEXT,
  "productName" TEXT,
  "fromDate" TIMESTAMP(3),
  "toDate" TIMESTAMP(3),
  "changedById" TEXT,
  "changedByName" TEXT,
  "changedByRole" TEXT,
  "prStatus" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseRequestDateHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PurchaseRequestDateHistory_requestId_createdAt_idx"
  ON "PurchaseRequestDateHistory"("requestId", "createdAt");

ALTER TABLE "PurchaseRequestDateHistory" DROP CONSTRAINT IF EXISTS "PurchaseRequestDateHistory_requestId_fkey";
ALTER TABLE "PurchaseRequestDateHistory"
  ADD CONSTRAINT "PurchaseRequestDateHistory_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "PurchaseRequest"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
