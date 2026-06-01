-- Stock-statement / opening-balance batches need a lightweight QC record to carry
-- batchNo / DOM / DOE / referred-unit data, but they don't have a parent PurchaseOrder.
-- Make the FK nullable so those synthetic records are valid.
ALTER TABLE "QCInspection" DROP CONSTRAINT "QCInspection_purchaseOrderId_fkey";
ALTER TABLE "QCInspection" ALTER COLUMN "purchaseOrderId" DROP NOT NULL;
ALTER TABLE "QCInspection"
  ADD CONSTRAINT "QCInspection_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
