-- Signed PO PDF lives on the PurchaseOrder, uploaded by the Purchase Officer once the quotation is approved.
-- It is the only PO document anyone in the chain sees; no auto-generated PDF is exposed.
ALTER TABLE "PurchaseOrder" ADD COLUMN "poDocumentUrl" TEXT;
