-- TEMPORARY FEATURE (rollout): Purchase may change the running count on a PO
-- number — RAPS/PO/<FY>/<n> — so the system agrees with the manual register.
-- Every rename is recorded here: from -> to, who, why, and the cascade counts
-- (batch numbers, stock/batch notes, MIV lines, inward rows, notifications).
--
-- The edit ACCESS goes away when the rollout ends (PO_NUMBER_EDIT_UNTIL in
-- server/src/middleware/rbac.js). This TABLE stays — a renumbering has to remain
-- traceable long after the button is gone.
-- Written idempotently (IF NOT EXISTS / drop-if-exists) so it is safe to re-apply.

CREATE TABLE IF NOT EXISTS "PurchaseOrderNumberHistory" (
  "id" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "fromNumber" TEXT NOT NULL,
  "toNumber" TEXT NOT NULL,
  "reason" TEXT,
  "cascade" JSONB,
  "changedById" TEXT,
  "changedByName" TEXT,
  "changedByRole" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseOrderNumberHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PurchaseOrderNumberHistory_purchaseOrderId_createdAt_idx"
  ON "PurchaseOrderNumberHistory"("purchaseOrderId", "createdAt");

ALTER TABLE "PurchaseOrderNumberHistory"
  DROP CONSTRAINT IF EXISTS "PurchaseOrderNumberHistory_purchaseOrderId_fkey";
ALTER TABLE "PurchaseOrderNumberHistory"
  ADD CONSTRAINT "PurchaseOrderNumberHistory_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
