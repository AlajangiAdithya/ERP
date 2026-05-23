-- Order name (PurchaseRequest.requestId) is no longer collected. Keep the column
-- for historical rows but allow new rows to skip it.
ALTER TABLE "PurchaseRequest" ALTER COLUMN "requestId" DROP NOT NULL;
