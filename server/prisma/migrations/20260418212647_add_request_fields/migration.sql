-- Add requestId field to PurchaseRequest table
ALTER TABLE "PurchaseRequest" ADD COLUMN "requestId" TEXT;

-- Add requestCreatedById field to QCInspection table
ALTER TABLE "QCInspection" ADD COLUMN "requestCreatedById" TEXT;
