-- FIM workflow enhancements:
--   1. Customer's gate-pass document type (ORIGINAL/DUPLICATE) + PDF upload URL on INWARD GatePass.
--   2. Stores → Unit assignment of FIM batches, and one-shot Unit-Manager acceptance with remark
--      (no MIV needed for FIM; once accepted, final).

-- 1. New enum for customer GP document type
CREATE TYPE "CustomerGpDocType" AS ENUM (
  'ORIGINAL',
  'DUPLICATE'
);

-- 2. GatePass: capture customer's GP document type + uploaded PDF,
--    plus the FIM/Customer Property Register number and a GP requisition no.
ALTER TABLE "GatePass"
  ADD COLUMN "customerGpDocType" "CustomerGpDocType",
  ADD COLUMN "customerGpPdfUrl"  TEXT,
  ADD COLUMN "fimNumber"         TEXT,
  ADD COLUMN "gpRequisitionNo"   TEXT;

CREATE UNIQUE INDEX "GatePass_fimNumber_key" ON "GatePass"("fimNumber");

-- 3. ProductBatch: FIM assignment + one-shot unit acceptance
ALTER TABLE "ProductBatch"
  ADD COLUMN "assignedToUnitId"    TEXT,
  ADD COLUMN "assignedAt"          TIMESTAMP(3),
  ADD COLUMN "assignedById"        TEXT,
  ADD COLUMN "unitAcceptedAt"      TIMESTAMP(3),
  ADD COLUMN "unitAcceptedById"    TEXT,
  ADD COLUMN "unitAcceptedRemarks" TEXT;

ALTER TABLE "ProductBatch"
  ADD CONSTRAINT "ProductBatch_assignedToUnitId_fkey"
    FOREIGN KEY ("assignedToUnitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ProductBatch_assignedById_fkey"
    FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ProductBatch_unitAcceptedById_fkey"
    FOREIGN KEY ("unitAcceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ProductBatch_assignedToUnitId_idx" ON "ProductBatch"("assignedToUnitId");
