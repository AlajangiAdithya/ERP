-- AlterTable
ALTER TABLE "PurchaseRequestItem" ALTER COLUMN "productName" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "plainPassword" TEXT;
