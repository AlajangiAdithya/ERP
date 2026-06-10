-- KPI-QMS certifications
-- Company certifications shown on every dashboard's KPI-QMS panel.
-- Only Unit-5 users upload; everyone views.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS "QmsCertification" (
    "id"            TEXT NOT NULL,
    "title"         TEXT NOT NULL,
    "certificateNo" TEXT,
    "issuedBy"      TEXT,
    "validFrom"     TIMESTAMP(3),
    "validTill"     TIMESTAMP(3),
    "fileUrl"       TEXT,
    "fileName"      TEXT,
    "notes"         TEXT,
    "uploadedById"  TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QmsCertification_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "QmsCertification" ADD CONSTRAINT "QmsCertification_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
