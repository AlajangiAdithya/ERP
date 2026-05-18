-- Phase 2: Quotation PDF + admin selection note + PO delay note
ALTER TABLE "Quotation" ADD COLUMN "quotationPdfUrl" TEXT;
ALTER TABLE "Quotation" ADD COLUMN "selectionNote" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN "delayNote" TEXT;

-- Phase 5: MIR auto-gen tracking on PurchaseOrder
ALTER TABLE "PurchaseOrder" ADD COLUMN "mirNo" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN "inwardedAt" TIMESTAMP(3);

-- Phase 4: QC inspection redesign (PO-driven request + re-review loop)
ALTER TABLE "QCInspection" ADD COLUMN "docRequirement" TEXT;
ALTER TABLE "QCInspection" ADD COLUMN "docRequirementNote" TEXT;
ALTER TABLE "QCInspection" ADD COLUMN "uploadedDocs" JSONB;
ALTER TABLE "QCInspection" ADD COLUMN "pendingReason" TEXT;
ALTER TABLE "QCInspection" ADD COLUMN "iteration" INTEGER NOT NULL DEFAULT 1;

-- Phase 4: extend QCResult enum with ON_HOLD
ALTER TYPE "QCResult" ADD VALUE IF NOT EXISTS 'ON_HOLD';

-- Phase 6: Per-unit inventory
CREATE TABLE "ProductUnitStock" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductUnitStock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductUnitStock_productId_unitId_key" ON "ProductUnitStock"("productId", "unitId");
CREATE INDEX "ProductUnitStock_unitId_idx" ON "ProductUnitStock"("unitId");

ALTER TABLE "ProductUnitStock" ADD CONSTRAINT "ProductUnitStock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductUnitStock" ADD CONSTRAINT "ProductUnitStock_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
