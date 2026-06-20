-- Product edit history — field-level audit of every edit made to a product's
-- details (ID No., name, material type, specification, shelf life, storage temp,
-- min level …). Surfaced on the Product Detail page. Captures who/when/role plus
-- a JSON array of { field, label, from, to } changes. Added so the Stores team's
-- temporary product-detail edit access (new-system rollout) is fully traceable.

CREATE TABLE "ProductEditHistory" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "changedById" TEXT,
  "changedByName" TEXT,
  "changedByRole" TEXT,
  "changes" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductEditHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductEditHistory_productId_createdAt_idx"
  ON "ProductEditHistory"("productId", "createdAt");

ALTER TABLE "ProductEditHistory"
  ADD CONSTRAINT "ProductEditHistory_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
