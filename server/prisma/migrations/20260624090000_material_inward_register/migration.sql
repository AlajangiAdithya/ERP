-- Material Inward Register (MIR) — the unified Stores inward record with its own
-- self-contained QC flow. Additive: one new table + two new enums. References
-- the existing "QCResult" enum for the QC outcome.

-- CreateEnum
CREATE TYPE "InwardDocType" AS ENUM ('INVOICE', 'CASH_PURCHASE', 'DELIVERY_CHALLAN', 'GATE_PASS');

-- CreateEnum
CREATE TYPE "InwardStatus" AS ENUM ('DRAFT', 'QC_REQUESTED', 'QC_IN_REVIEW', 'QC_DONE', 'INWARDED');

-- CreateTable
CREATE TABLE "MaterialInwardRegister" (
    "id" TEXT NOT NULL,
    "mirNo" TEXT NOT NULL,
    "inwardDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vehicleDetails" TEXT,
    "docType" "InwardDocType" NOT NULL DEFAULT 'INVOICE',
    "docNumber" TEXT,
    "purchaseOrderId" TEXT,
    "purchaseOrderItemId" TEXT,
    "supplierName" TEXT,
    "prNumbers" TEXT,
    "itemDescription" TEXT,
    "uom" TEXT,
    "qtyReceived" DOUBLE PRECISION,
    "productId" TEXT,
    "issuedToUnitId" TEXT,
    "issuedToDept" TEXT,
    "issuedToLabel" TEXT,
    "purpose" TEXT,
    "batchNo" TEXT,
    "dateOfExpiry" TIMESTAMP(3),
    "status" "InwardStatus" NOT NULL DEFAULT 'DRAFT',
    "qcRequestedAt" TIMESTAMP(3),
    "qcRequestedById" TEXT,
    "qcRequestNote" TEXT,
    "qcDocRequirement" TEXT,
    "qcReviewerId" TEXT,
    "qcReviewStartedAt" TIMESTAMP(3),
    "qcResult" "QCResult",
    "qtyAccepted" DOUBLE PRECISION,
    "qtyRejected" DOUBLE PRECISION,
    "qcReportNo" TEXT,
    "qcReportRemark" TEXT,
    "qcFinishedAt" TIMESTAMP(3),
    "inwardedAt" TIMESTAMP(3),
    "batchId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialInwardRegister_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MaterialInwardRegister_mirNo_key" ON "MaterialInwardRegister"("mirNo");

-- CreateIndex
CREATE INDEX "MaterialInwardRegister_purchaseOrderId_idx" ON "MaterialInwardRegister"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "MaterialInwardRegister_status_idx" ON "MaterialInwardRegister"("status");

-- CreateIndex
CREATE INDEX "MaterialInwardRegister_productId_idx" ON "MaterialInwardRegister"("productId");

-- CreateIndex
CREATE INDEX "MaterialInwardRegister_batchNo_idx" ON "MaterialInwardRegister"("batchNo");
