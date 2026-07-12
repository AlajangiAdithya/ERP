-- Header-level R&D flag on a Purchase Requisition. Chosen instead of a Work
-- Order in the PR form's Work Order dropdown when the materials are for product
-- research. Mutually exclusive with workOrderId.

ALTER TABLE "PurchaseRequest" ADD COLUMN "isRnd" BOOLEAN NOT NULL DEFAULT false;
