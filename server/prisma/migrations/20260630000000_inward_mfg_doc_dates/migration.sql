-- Material Inward Register: capture the document date (date on the invoice / DC /
-- gate pass) and the manufacturing date of the received lot, both as supplied.
ALTER TABLE "MaterialInwardRegister" ADD COLUMN IF NOT EXISTS "documentDate" TIMESTAMP(3);
ALTER TABLE "MaterialInwardRegister" ADD COLUMN IF NOT EXISTS "manufacturingDate" TIMESTAMP(3);
