-- ────────────────────────────────────────────────────────────
-- Union Purchase Orders: aggregate identical items across PRs
-- from multiple units into one consolidated quotation/PO,
-- with per-PR-item allocation tracking for receiving.
-- ────────────────────────────────────────────────────────────

-- Quotation: relax 1:1 PR link and flag union quotations
ALTER TABLE "Quotation" DROP CONSTRAINT IF EXISTS "Quotation_purchaseRequestId_fkey";
ALTER TABLE "Quotation" ALTER COLUMN "purchaseRequestId" DROP NOT NULL;
ALTER TABLE "Quotation" ADD COLUMN "isUnion" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Quotation"
  ADD CONSTRAINT "Quotation_purchaseRequestId_fkey"
  FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- QuotationItem: carry the per-PR-item allocation breakdown for union items
ALTER TABLE "QuotationItem" ADD COLUMN "sourceAllocations" JSONB;

-- QuotationSource: junction PR ↔ Union Quotation
CREATE TABLE "QuotationSource" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "purchaseRequestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuotationSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuotationSource_quotationId_purchaseRequestId_key"
  ON "QuotationSource"("quotationId", "purchaseRequestId");

ALTER TABLE "QuotationSource"
  ADD CONSTRAINT "QuotationSource_quotationId_fkey"
  FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuotationSource"
  ADD CONSTRAINT "QuotationSource_purchaseRequestId_fkey"
  FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- PurchaseOrder: relax 1:1 PR link and flag union POs
ALTER TABLE "PurchaseOrder" DROP CONSTRAINT IF EXISTS "PurchaseOrder_purchaseRequestId_fkey";
ALTER TABLE "PurchaseOrder" ALTER COLUMN "purchaseRequestId" DROP NOT NULL;
ALTER TABLE "PurchaseOrder" ADD COLUMN "isUnion" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_purchaseRequestId_fkey"
  FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- PurchaseOrderSource: junction PR ↔ Union PO
CREATE TABLE "PurchaseOrderSource" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "purchaseRequestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseOrderSource_purchaseOrderId_purchaseRequestId_key"
  ON "PurchaseOrderSource"("purchaseOrderId", "purchaseRequestId");

ALTER TABLE "PurchaseOrderSource"
  ADD CONSTRAINT "PurchaseOrderSource_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrderSource"
  ADD CONSTRAINT "PurchaseOrderSource_purchaseRequestId_fkey"
  FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- PurchaseOrderItemAllocation: per-PR-item slice of a union PO item.
-- Non-union PO items keep their single purchaseRequestItemId on PurchaseOrderItem
-- and leave this table empty for backward compatibility.
CREATE TABLE "PurchaseOrderItemAllocation" (
    "id" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT NOT NULL,
    "purchaseRequestItemId" TEXT NOT NULL,
    "allocatedQty" DOUBLE PRECISION NOT NULL,
    "receivedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderItemAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseOrderItemAllocation_poItem_prItem_key"
  ON "PurchaseOrderItemAllocation"("purchaseOrderItemId", "purchaseRequestItemId");

ALTER TABLE "PurchaseOrderItemAllocation"
  ADD CONSTRAINT "PurchaseOrderItemAllocation_purchaseOrderItemId_fkey"
  FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrderItemAllocation"
  ADD CONSTRAINT "PurchaseOrderItemAllocation_purchaseRequestItemId_fkey"
  FOREIGN KEY ("purchaseRequestItemId") REFERENCES "PurchaseRequestItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
