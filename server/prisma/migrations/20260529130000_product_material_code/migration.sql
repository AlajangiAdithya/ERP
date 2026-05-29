-- Customer/legacy identification number from the Material Details register.
-- Independent of the auto-generated RAW/CONS/TOOL/OTH SKU.
ALTER TABLE "Product"
  ADD COLUMN "materialCode" TEXT;

CREATE UNIQUE INDEX "Product_materialCode_key" ON "Product"("materialCode");
