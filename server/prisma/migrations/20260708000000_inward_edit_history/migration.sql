-- Material Inward Register: an append-only edit log on each row. Every field edit
-- records who changed what (field, from -> to) and when, surfaced inline via a
-- small "edited" eye icon on the row.
ALTER TABLE "MaterialInwardRegister" ADD COLUMN IF NOT EXISTS "editHistory" JSONB;
