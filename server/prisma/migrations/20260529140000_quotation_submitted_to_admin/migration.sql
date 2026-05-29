-- Add explicit PO-to-admin submission gate to Quotation.
-- Null = still in PO draft state; non-null = visible to admin for review.
ALTER TABLE "Quotation"
  ADD COLUMN "submittedToAdminAt"   TIMESTAMP(3),
  ADD COLUMN "submittedToAdminById" TEXT;

ALTER TABLE "Quotation"
  ADD CONSTRAINT "Quotation_submittedToAdminById_fkey"
  FOREIGN KEY ("submittedToAdminById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every existing quotation pre-dates this gate, so treat it as
-- already submitted. Use createdAt as the proxy submission timestamp and the
-- creator as the submitter — they're the same person (PO) in legacy data.
UPDATE "Quotation"
SET "submittedToAdminAt" = "createdAt",
    "submittedToAdminById" = "createdById";
