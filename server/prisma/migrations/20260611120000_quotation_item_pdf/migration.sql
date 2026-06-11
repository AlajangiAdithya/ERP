-- Per-product supplier-quote PDF on each quotation line item.
-- A quotation can now carry one supplier-quote document per product instead of
-- a single PDF for the whole quotation. The quotation-level Quotation.quotationPdfUrl
-- is kept for backward compatibility (older rows / single combined quotes).
ALTER TABLE "QuotationItem" ADD COLUMN IF NOT EXISTS "quotationPdfUrl" TEXT;
