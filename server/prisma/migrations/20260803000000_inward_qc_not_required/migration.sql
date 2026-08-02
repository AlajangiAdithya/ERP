-- "QC not required" waiver on the Material Inward Register.
--
-- Material arriving against a PO is routed through QC by default, but plenty of
-- receipts genuinely need no inspection (standard consumables, stationery,
-- re-orders of a proven part). When Stores hands a lot to QC the owning unit's
-- manager is now notified, and QC / that manager / an Admin may mark the lot
-- "QC not required" — it skips inspection and moves straight to the inward step.
--
-- Stores deliberately cannot waive: the call belongs to QC or the manager the
-- material is for. The waiver is reversible — Stores can resend a waived lot to
-- QC, which clears qcWaived* and puts it back in the normal inspection flow.

-- New terminal-before-inward status for a waived lot.
ALTER TYPE "InwardStatus" ADD VALUE IF NOT EXISTS 'QC_NOT_REQUIRED';

-- Who waived it, when, and why (a meaningful reason is enforced server-side).
ALTER TABLE "MaterialInwardRegister"
  ADD COLUMN IF NOT EXISTS "qcWaived"       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "qcWaivedAt"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "qcWaivedById"   TEXT,
  ADD COLUMN IF NOT EXISTS "qcWaivedReason" TEXT;
