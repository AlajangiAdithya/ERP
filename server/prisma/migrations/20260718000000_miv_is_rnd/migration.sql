-- Header-level R&D flag on an MIV (ProductRequest). Chosen instead of a Work
-- Order in the MIV form's Work Order dropdown when the materials are for product
-- research. Mutually exclusive with workOrderId. Mirrors PurchaseRequest.isRnd.

ALTER TABLE "ProductRequest" ADD COLUMN IF NOT EXISTS "isRnd" BOOLEAN NOT NULL DEFAULT false;
