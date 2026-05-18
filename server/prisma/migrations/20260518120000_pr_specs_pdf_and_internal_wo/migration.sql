-- Add material specs PDF URL on PurchaseRequest
ALTER TABLE "PurchaseRequest" ADD COLUMN "materialSpecsPdfUrl" TEXT;

-- Add internal work order on PurchaseRequestItem
ALTER TABLE "PurchaseRequestItem" ADD COLUMN "internalWorkOrder" TEXT;
