-- MIV → Purchase Request link.
-- Stores records which PR the material is being issued against at MIV clearance
-- (they type/pick the PR number only). Nullable: many MIVs draw general stock
-- with no PR behind them. ON DELETE SET NULL so removing a PR never cascades
-- into the MIVs that referenced it.
ALTER TABLE "ProductRequest" ADD COLUMN "purchaseRequestId" TEXT;

CREATE INDEX "ProductRequest_purchaseRequestId_idx" ON "ProductRequest"("purchaseRequestId");

ALTER TABLE "ProductRequest"
  ADD CONSTRAINT "ProductRequest_purchaseRequestId_fkey"
  FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
