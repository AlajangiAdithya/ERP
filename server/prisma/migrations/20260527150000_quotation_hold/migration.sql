-- Admin can put a submitted quotation on hold (e.g. supplier compliance PDFs
-- missing or expired) and notify the Purchase Officer with a reason. The PO
-- uploads what's needed on the Supplier; admin then re-reviews and approves.
ALTER TABLE "Quotation" ADD COLUMN "holdNote" TEXT;
ALTER TABLE "Quotation" ADD COLUMN "heldAt" TIMESTAMP(3);
