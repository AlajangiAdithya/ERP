-- Material Inward Register — capture the indenter (the person who raised the
-- source PR) so inwarded material is attributed to the requester, and so the
-- department/unit assignment matches the PO→inward flow. Additive, nullable.

ALTER TABLE "MaterialInwardRegister" ADD COLUMN IF NOT EXISTS "indenterId"   TEXT;
ALTER TABLE "MaterialInwardRegister" ADD COLUMN IF NOT EXISTS "indenterName" TEXT;
