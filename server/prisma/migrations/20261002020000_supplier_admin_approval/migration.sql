-- Admin approval of a supplier. Purchase onboards the vendor and uploads the
-- required documents; the supplier then goes to Admin as PENDING_APPROVAL and is
-- only APPROVED once an Admin agrees. Existing rows are untouched - a supplier
-- already marked APPROVED stays approved.
ALTER TYPE "SupplierApprovalStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL' BEFORE 'APPROVED';

ALTER TABLE "Supplier"
  ADD COLUMN IF NOT EXISTS "approvalSubmittedAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvalSubmittedById" TEXT,
  ADD COLUMN IF NOT EXISTS "approvalDecidedAt"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvalDecidedById"   TEXT,
  ADD COLUMN IF NOT EXISTS "approvalRemark"        TEXT;
