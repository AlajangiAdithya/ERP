-- FIM (customer property) is not Master Data.
--
-- Every FIM line auto-creates a Product row so the batch, stock movement and
-- unit assignment have something to hang off. That row is plumbing, not a
-- material in our catalogue: it must stay out of the products list, the product
-- pickers, the dashboard counts, the category list and the material-code
-- register. Until now the only thing keeping it out of the products list was a
-- "has no non-FIM batch" subquery, which misses a FIM product that has no batch
-- yet and leaks everywhere else. Make it explicit instead.
ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "isCustomerProperty" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: a product is customer property when every batch it has is FIM, it
-- has at least one, and nothing in the purchasing / issue chain ever referenced
-- it. The last three guards keep a genuine catalogue material that happens to
-- have taken in a FIM batch from being hidden.
UPDATE "Product" p
SET "isCustomerProperty" = true
WHERE EXISTS (SELECT 1 FROM "ProductBatch" b WHERE b."productId" = p.id AND b."isFim")
  AND NOT EXISTS (SELECT 1 FROM "ProductBatch" b WHERE b."productId" = p.id AND NOT b."isFim")
  AND NOT EXISTS (SELECT 1 FROM "PurchaseRequestItem" x WHERE x."productId" = p.id)
  AND NOT EXISTS (SELECT 1 FROM "PurchaseOrderItem"   x WHERE x."productId" = p.id)
  AND NOT EXISTS (SELECT 1 FROM "RequestItem"         x WHERE x."productId" = p.id);

-- The products list, the dashboard counts and the code register all filter on
-- this now, so it is read on every one of those queries.
CREATE INDEX IF NOT EXISTS "Product_isCustomerProperty_idx"
  ON "Product" ("isCustomerProperty");
