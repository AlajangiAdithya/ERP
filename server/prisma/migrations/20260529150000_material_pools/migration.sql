-- MaterialPool: PO bundles same-material PR-items together before quoting.
-- Pool membership is orthogonal to PRItemQuotationStatus; once a union quote
-- tied to the pool gets submitted, downstream PO + FIFO inward already works
-- via the existing PurchaseOrderItemAllocation chain.

CREATE TYPE "MaterialPoolStatus" AS ENUM ('OPEN', 'QUOTED', 'APPROVED', 'CANCELLED');

CREATE TABLE "MaterialPool" (
  "id"          TEXT NOT NULL,
  "productId"   TEXT,
  "productName" TEXT NOT NULL,
  "productUnit" TEXT NOT NULL DEFAULT 'pcs',
  "status"      "MaterialPoolStatus" NOT NULL DEFAULT 'OPEN',
  "createdById" TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MaterialPool_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MaterialPool_status_idx"    ON "MaterialPool"("status");
CREATE INDEX "MaterialPool_productId_idx" ON "MaterialPool"("productId");

ALTER TABLE "MaterialPool"
  ADD CONSTRAINT "MaterialPool_productId_fkey"   FOREIGN KEY ("productId")   REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "MaterialPool_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id")    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "MaterialPoolItem" (
  "id"                    TEXT NOT NULL,
  "poolId"                TEXT NOT NULL,
  "purchaseRequestItemId" TEXT NOT NULL,
  "pooledAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaterialPoolItem_pkey" PRIMARY KEY ("id")
);

-- A PR-item can be in at most one pool at a time. Unpooling deletes the row,
-- freeing the PR-item to be quoted on its own or pooled into a different group.
CREATE UNIQUE INDEX "MaterialPoolItem_purchaseRequestItemId_key" ON "MaterialPoolItem"("purchaseRequestItemId");
CREATE INDEX        "MaterialPoolItem_poolId_idx"                ON "MaterialPoolItem"("poolId");

ALTER TABLE "MaterialPoolItem"
  ADD CONSTRAINT "MaterialPoolItem_poolId_fkey"                FOREIGN KEY ("poolId")                REFERENCES "MaterialPool"("id")        ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "MaterialPoolItem_purchaseRequestItemId_fkey" FOREIGN KEY ("purchaseRequestItemId") REFERENCES "PurchaseRequestItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
