-- QC failure → NCR + replacement chain on the Material Inward Register.
-- On a QC FAILED lot, QC uploads a Non-Conformance Report (ncrNo / ncrDocUrl /
-- ncrDocName / ncrUploadedAt). Stores then raises a replacement inward that is
-- mapped back to the failed MIR: the replacement carries replacesInwardId and the
-- failed row is stamped with replacedByInwardId. The replacement re-runs the full
-- QC cycle while still pointing at the failed lot's NCR + reference documents.
ALTER TABLE "MaterialInwardRegister" ADD COLUMN IF NOT EXISTS "ncrNo" TEXT;
ALTER TABLE "MaterialInwardRegister" ADD COLUMN IF NOT EXISTS "ncrDocUrl" TEXT;
ALTER TABLE "MaterialInwardRegister" ADD COLUMN IF NOT EXISTS "ncrDocName" TEXT;
ALTER TABLE "MaterialInwardRegister" ADD COLUMN IF NOT EXISTS "ncrUploadedAt" TIMESTAMP(3);
ALTER TABLE "MaterialInwardRegister" ADD COLUMN IF NOT EXISTS "replacesInwardId" TEXT;
ALTER TABLE "MaterialInwardRegister" ADD COLUMN IF NOT EXISTS "replacedByInwardId" TEXT;
