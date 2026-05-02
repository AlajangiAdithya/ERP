-- AlterTable: Make productId optional, add productName and productUnit
ALTER TABLE "PurchaseRequestItem" ALTER COLUMN "productId" DROP NOT NULL;

ALTER TABLE "PurchaseRequestItem" ADD COLUMN "productName" TEXT NOT NULL DEFAULT 'Unknown Product';

ALTER TABLE "PurchaseRequestItem" ADD COLUMN "productUnit" TEXT NOT NULL DEFAULT 'pcs';

-- DropForeignKey (recreate as optional)
ALTER TABLE "PurchaseRequestItem" DROP CONSTRAINT "PurchaseRequestItem_productId_fkey";

-- AddForeignKey (optional)
ALTER TABLE "PurchaseRequestItem" ADD CONSTRAINT "PurchaseRequestItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
