-- QMS document library (SOPs + Work Instructions) on the QMS hub.
-- Everyone views; Unit-5 uploads. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS "QmsDocument" (
    "id"           TEXT NOT NULL,
    "category"     TEXT NOT NULL,
    "title"        TEXT NOT NULL,
    "docNo"        TEXT,
    "revision"     TEXT,
    "fileUrl"      TEXT,
    "fileName"     TEXT,
    "notes"        TEXT,
    "uploadedById" TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QmsDocument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "QmsDocument_category_idx" ON "QmsDocument"("category");

DO $$ BEGIN
  ALTER TABLE "QmsDocument" ADD CONSTRAINT "QmsDocument_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
