-- Reusable material-spec PDF library per product. Populated when raising a PR
-- (pick an existing spec or upload a new one) and manageable from Product Detail
-- by Stores/Admin. Distinct from Product.msds and PurchaseRequestItem.specAttachmentUrl.

CREATE TABLE "ProductSpec" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "uploadedById" TEXT,
    "uploadedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductSpec_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductSpec_productId_idx" ON "ProductSpec"("productId");

ALTER TABLE "ProductSpec"
    ADD CONSTRAINT "ProductSpec_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
