-- Global requester roles (SAFETY, DESIGNS, QC, LAB, METROLOGY, NDT,
-- STORE_MANAGER, PLANNING) raise PRs and MIVs in their own name with no unit.
-- The routes already write unitId = null, but the columns were NOT NULL —
-- every such create failed. Make both nullable.
-- Idempotent: safe to re-run.

ALTER TABLE "PurchaseRequest" ALTER COLUMN "unitId" DROP NOT NULL;
ALTER TABLE "ProductRequest" ALTER COLUMN "unitId" DROP NOT NULL;
