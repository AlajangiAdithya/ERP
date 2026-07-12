-- Header-level R&D flag on a Purchase Requisition. Chosen instead of a Work
-- Order in the PR form's Work Order dropdown when the materials are for product
-- research. Mutually exclusive with workOrderId. Idempotent (IF NOT EXISTS).

ALTER TABLE "PurchaseRequest" ADD COLUMN IF NOT EXISTS "isRnd" BOOLEAN NOT NULL DEFAULT false;
