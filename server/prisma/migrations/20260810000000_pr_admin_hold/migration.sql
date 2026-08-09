-- Admin hold on a purchase requisition: "send back for clarification".
-- Admin has a doubt, writes a remark, and the PR goes ON_HOLD back to the raiser
-- instead of being rejected. The raiser answers (and may fix the lines) and
-- resends, which returns it to PENDING_ADMIN.
--
-- holdRemark  = the CURRENT open question (cleared when the raiser responds)
-- holdCount   = how many times this PR has been held
-- holdHistory = every round, so repeat holds never lose the earlier exchange
--               [{ round, remark, heldById, heldByName, heldAt,
--                  response, respondedById, respondedByName, respondedAt }]
--
-- Mirrors MaterialInwardRegister.holdReason / holdCount / qcHistory on QC inward.
-- Written idempotently (IF NOT EXISTS / drop-if-exists) so it is safe to re-apply.

-- Placed before APPROVED so the DB enum order matches schema.prisma (ON_HOLD is
-- a branch off admin approval, not a stage after it).
ALTER TYPE "PurchaseRequestStatus" ADD VALUE IF NOT EXISTS 'ON_HOLD' BEFORE 'APPROVED';

ALTER TABLE "PurchaseRequest" ADD COLUMN IF NOT EXISTS "holdRemark" TEXT;
ALTER TABLE "PurchaseRequest" ADD COLUMN IF NOT EXISTS "heldAt" TIMESTAMP(3);
ALTER TABLE "PurchaseRequest" ADD COLUMN IF NOT EXISTS "heldById" TEXT;
ALTER TABLE "PurchaseRequest" ADD COLUMN IF NOT EXISTS "holdCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseRequest" ADD COLUMN IF NOT EXISTS "holdHistory" JSONB;

ALTER TABLE "PurchaseRequest" DROP CONSTRAINT IF EXISTS "PurchaseRequest_heldById_fkey";
ALTER TABLE "PurchaseRequest"
  ADD CONSTRAINT "PurchaseRequest_heldById_fkey"
  FOREIGN KEY ("heldById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
