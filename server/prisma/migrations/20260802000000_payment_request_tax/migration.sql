-- GST / tax on payment requests.
-- The Purchase Officer picks a tax % when raising the request; `amount` keeps
-- meaning the taxable (basic) value so the PO ledger (totalPaid vs totalAmount,
-- both pre-tax) is untouched, and the tax + payable total ride alongside it.
--
-- Written idempotently (IF NOT EXISTS) so it is safe to re-apply on a database
-- where the columns were already created by an earlier `prisma db push`.

ALTER TABLE "PaymentRequest" ADD COLUMN IF NOT EXISTS "taxPercent" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PaymentRequest" ADD COLUMN IF NOT EXISTS "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PaymentRequest" ADD COLUMN IF NOT EXISTS "payableAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Existing requests carried no tax, so what was payable is exactly the amount.
UPDATE "PaymentRequest" SET "payableAmount" = "amount" WHERE "payableAmount" = 0;
