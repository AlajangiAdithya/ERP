-- Product storage handling: shelf life + storage (room) temperature, filled by
-- Stores at inward and editable from the products list; plus a Material Safety
-- Data Sheet (MSDS) PDF. All additive & nullable.

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "shelfLife"   TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "storageTemp" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "msdsUrl"     TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "msdsName"    TEXT;
