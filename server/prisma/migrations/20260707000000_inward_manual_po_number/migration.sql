-- Material Inward Register: an existing PO that isn't in the system yet (rollout
-- period). Stores types the PO number by hand and records the items like a cash
-- purchase. Mutually exclusive with the real purchaseOrderId link.
ALTER TABLE "MaterialInwardRegister" ADD COLUMN IF NOT EXISTS "manualPoNumber" TEXT;
