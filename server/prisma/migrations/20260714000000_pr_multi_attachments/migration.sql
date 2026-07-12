-- Multi-file spec attachments per PR line + header-level "note" attachments.
-- Supersedes the single PurchaseRequestItem.specAttachmentUrl/Name columns
-- (kept and back-filled here for backward compatibility). Any format is allowed
-- (PDF, image scans, DWG, DOC/DOCX, XLS/XLSX, zip) — the UI treats them as links.

-- Per-line material-spec attachments (multiple per PR item).
CREATE TABLE "PurchaseRequestItemAttachment" (
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

CREATE INDEX "PurchaseRequestItemAttachment_itemId_idx"
  ON "PurchaseRequestItemAttachment"("itemId");

ALTER TABLE "PurchaseRequestItemAttachment"
  ADD CONSTRAINT "PurchaseRequestItemAttachment_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "PurchaseRequestItem"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Header-level "note" attachments (multiple per PR).
CREATE TABLE "PurchaseRequestAttachment" (
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

CREATE INDEX "PurchaseRequestAttachment_requestId_idx"
  ON "PurchaseRequestAttachment"("requestId");

ALTER TABLE "PurchaseRequestAttachment"
  ADD CONSTRAINT "PurchaseRequestAttachment_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "PurchaseRequest"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Back-fill: migrate every existing single spec attachment into the new
-- per-line table so historical PRs surface their spec through the new relation.
INSERT INTO "PurchaseRequestItemAttachment" ("id", "itemId", "url", "name", "createdAt")
SELECT
  gen_random_uuid()::text,
  "id",
  "specAttachmentUrl",
  COALESCE("specAttachmentName", 'spec.pdf'),
  CURRENT_TIMESTAMP
FROM "PurchaseRequestItem"
WHERE "specAttachmentUrl" IS NOT NULL AND "specAttachmentUrl" <> '';
