-- Multi-file spec attachments per PR line + header-level "note" attachments.
-- Supersedes the single PurchaseRequestItem.specAttachmentUrl/Name columns
-- (kept and back-filled here for backward compatibility). Any format is allowed
-- (PDF, image scans, DWG, DOC/DOCX, XLS/XLSX, zip) — the UI treats them as links.
-- Written idempotently (IF NOT EXISTS / drop-if-exists) so it is safe to re-apply.

-- Per-line material-spec attachments (multiple per PR item).
CREATE TABLE IF NOT EXISTS "PurchaseRequestItemAttachment" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "mimeType" TEXT,
  "uploadedById" TEXT,
  "uploadedByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseRequestItemAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PurchaseRequestItemAttachment_itemId_idx"
  ON "PurchaseRequestItemAttachment"("itemId");

ALTER TABLE "PurchaseRequestItemAttachment"
  DROP CONSTRAINT IF EXISTS "PurchaseRequestItemAttachment_itemId_fkey";
ALTER TABLE "PurchaseRequestItemAttachment"
  ADD CONSTRAINT "PurchaseRequestItemAttachment_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "PurchaseRequestItem"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Header-level "note" attachments (multiple per PR).
CREATE TABLE IF NOT EXISTS "PurchaseRequestAttachment" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "mimeType" TEXT,
  "uploadedById" TEXT,
  "uploadedByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseRequestAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PurchaseRequestAttachment_requestId_idx"
  ON "PurchaseRequestAttachment"("requestId");

ALTER TABLE "PurchaseRequestAttachment"
  DROP CONSTRAINT IF EXISTS "PurchaseRequestAttachment_requestId_fkey";
ALTER TABLE "PurchaseRequestAttachment"
  ADD CONSTRAINT "PurchaseRequestAttachment_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "PurchaseRequest"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Back-fill: migrate every existing single spec attachment into the new per-line
-- table. The NOT EXISTS guard keeps the back-fill safe to run more than once.
INSERT INTO "PurchaseRequestItemAttachment" ("id", "itemId", "url", "name", "createdAt")
SELECT
  gen_random_uuid()::text,
  i."id",
  i."specAttachmentUrl",
  COALESCE(i."specAttachmentName", 'spec.pdf'),
  CURRENT_TIMESTAMP
FROM "PurchaseRequestItem" i
WHERE i."specAttachmentUrl" IS NOT NULL AND i."specAttachmentUrl" <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "PurchaseRequestItemAttachment" a
    WHERE a."itemId" = i."id" AND a."url" = i."specAttachmentUrl"
  );
