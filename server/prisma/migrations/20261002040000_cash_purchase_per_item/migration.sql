-- Cash purchase becomes a PER-LINE decision instead of a whole-PR one.
--
-- Before: converting a PR to cash purchase CANCELLED every line on it and flipped
-- the whole PR to CASH_PURCHASE, so a 10-line PR where only 2 items were bought
-- over the counter lost the other 8. Receiving any cash material then closed the
-- entire PR.
--
-- After: the 2 cash lines carry itemQuotationStatus = CASH_PURCHASE and are
-- received against their own MIR line; the other 8 stay in the quotation/PO chain
-- and the PR stays open until everything is settled.
ALTER TYPE "PRItemQuotationStatus" ADD VALUE IF NOT EXISTS 'CASH_PURCHASE' BEFORE 'CANCELLED';

-- Which PR line a cash receipt satisfies. Null for an unplanned cash purchase
-- with no PR behind it, and for every historic row.
ALTER TABLE "MaterialInwardRegister"
  ADD COLUMN IF NOT EXISTS "cashPurchaseRequestItemId" TEXT;

CREATE INDEX IF NOT EXISTS "MaterialInwardRegister_cashPurchaseRequestItemId_idx"
  ON "MaterialInwardRegister" ("cashPurchaseRequestItemId");

DO $$
BEGIN
  ALTER TABLE "MaterialInwardRegister"
    ADD CONSTRAINT "MaterialInwardRegister_cashPurchaseRequestItemId_fkey"
    FOREIGN KEY ("cashPurchaseRequestItemId") REFERENCES "PurchaseRequestItem"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
