-- Link Purchase Requests (PR) and Product Requests (MIV) to a Work Order.
-- Header-level, nullable FK (null = "No work order"). SetNull so deleting a
-- Work Order never cascades into deleting the PRs / MIVs raised against it.
ALTER TABLE "PurchaseRequest" ADD COLUMN "workOrderId" TEXT;
ALTER TABLE "ProductRequest"  ADD COLUMN "workOrderId" TEXT;

ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductRequest"  ADD CONSTRAINT "ProductRequest_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "PurchaseRequest_workOrderId_idx" ON "PurchaseRequest"("workOrderId");
CREATE INDEX "ProductRequest_workOrderId_idx"  ON "ProductRequest"("workOrderId");

-- Some imported work orders carry only a relative delivery term (e.g.
-- "FIM+3 Months") instead of a real PDC date. Allow PDC to be empty; the term
-- is stored in deliveryClause and the real date is filled in later.
ALTER TABLE "WorkOrder" ALTER COLUMN "pdcDate" DROP NOT NULL;
