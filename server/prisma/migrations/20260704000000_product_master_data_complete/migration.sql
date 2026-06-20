-- Master-data gate for products.
--   • masterDataComplete = false means the product exists but its master data
--     (specification / shelf life …) hasn't been added by a unit head / QC yet.
--   • Stores cannot inward a non-Tools&Fixtures material until this is true.
--   • Backfill every EXISTING product to true (they are established master data);
--     only products created after this migration start false until enriched.

ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "masterDataComplete" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Product" SET "masterDataComplete" = true;
