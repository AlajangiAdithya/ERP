-- QC sign-off on inspections carried out by the inspection-only operators
-- (INWARD_QC / IN_PROCESS_QC). Their finished review now parks at
-- QC_PENDING_APPROVAL instead of QC_DONE, so Stores cannot inward the lot and the
-- Stores / NCR notifications do not fire until QC (or Admin) approves it.
-- Reviews finished by QC itself are unaffected and still land on QC_DONE.
ALTER TYPE "InwardStatus" ADD VALUE IF NOT EXISTS 'QC_PENDING_APPROVAL' BEFORE 'QC_DONE';

ALTER TABLE "MaterialInwardRegister"
  ADD COLUMN IF NOT EXISTS "qcApprovedById"   TEXT,
  ADD COLUMN IF NOT EXISTS "qcApprovedAt"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "qcApprovalRemark" TEXT;
