-- Manual PO numbering.
-- PO numbers are no longer generated when a quotation is approved: Purchase type
-- RAPS/PO/<FY>/<n> in themselves before the order can be placed. The column
-- therefore has to accept NULL for the "awaiting number" window. Postgres allows
-- any number of NULLs under a UNIQUE index, so the existing uniqueness guarantee
-- on real numbers is untouched.
ALTER TABLE "PurchaseOrder" ALTER COLUMN "orderNumber" DROP NOT NULL;

-- Who typed the number in, and when. Left NULL on every pre-existing order --
-- those numbers were issued automatically and have no assigner.
ALTER TABLE "PurchaseOrder" ADD COLUMN "numberAssignedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseOrder" ADD COLUMN "numberAssignedById" TEXT;

ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_numberAssignedById_fkey"
  FOREIGN KEY ("numberAssignedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
