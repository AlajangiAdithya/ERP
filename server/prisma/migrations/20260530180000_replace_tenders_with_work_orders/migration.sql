-- Drop legacy Tender table + enum (SUPPLY_CHAIN no longer manages tenders).
-- Replace with WorkOrder + supporting tables modelled on the printable
-- RAPS/WO/01 form.

-- ── Drop Tender ───────────────────────────────────────────────────────
DROP TABLE IF EXISTS "Tender" CASCADE;
DROP TYPE IF EXISTS "TenderStatus";

-- ── WorkOrder enums ───────────────────────────────────────────────────
CREATE TYPE "WorkOrderStatus" AS ENUM (
  'PENDING_ADMIN',
  'ADMIN_ACCEPTED',
  'UNIT_ACCEPTED',
  'IN_PROGRESS',
  'COMPLETED',
  'CLOSED',
  'CANCELLED',
  'REJECTED'
);

CREATE TYPE "WorkOrderDeliveryStatus" AS ENUM (
  'NOT_STARTED',
  'IN_PROGRESS',
  'PARTIAL',
  'DELIVERED',
  'DELAYED'
);

-- ── WorkOrder ─────────────────────────────────────────────────────────
CREATE TABLE "WorkOrder" (
  "id"                     TEXT NOT NULL,
  "workOrderNumber"        TEXT NOT NULL,
  "ionNumber"              TEXT,
  "supplyOrderNo"          TEXT NOT NULL,
  "supplyOrderDate"        TIMESTAMP(3) NOT NULL,
  "supplyOrderDescription" TEXT,
  "customerName"           TEXT NOT NULL,
  "customerContact"        TEXT,
  "orderQuantity"          DOUBLE PRECISION NOT NULL,
  "orderUnit"              TEXT NOT NULL DEFAULT 'Nos',
  "pdcDate"                TIMESTAMP(3) NOT NULL,
  "deliveryClause"         TEXT,
  "fimDetails"             TEXT,
  "inspectionAgency"       TEXT,
  "qapNo"                  TEXT,
  "drawingsDetails"        TEXT,
  "processDrawingsDetails" TEXT,
  "toolingScope"           TEXT,
  "packingDetails"         TEXT,
  "transportationDetails"  TEXT,
  "majorWorksAtSite"       TEXT,
  "projectCoordinator"     TEXT,
  "otherInformation"       TEXT,
  "orderTermsAndScope"     TEXT,
  "remarks"                TEXT,
  "bankGuaranteeNo"        TEXT,
  "bankGuaranteeDate"      TIMESTAMP(3),
  "insuranceNo"            TEXT,
  "insuranceDate"          TIMESTAMP(3),
  "assignedUnitId"         TEXT,
  "unitAcceptedAt"         TIMESTAMP(3),
  "unitAcceptedById"       TEXT,
  "unitAcceptanceNote"     TEXT,
  "adminAcceptedAt"        TIMESTAMP(3),
  "adminAcceptedById"      TEXT,
  "adminAcceptanceNote"    TEXT,
  "status"                 "WorkOrderStatus" NOT NULL DEFAULT 'PENDING_ADMIN',
  "deliveryStatus"         "WorkOrderDeliveryStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "deliveredQty"           DOUBLE PRECISION NOT NULL DEFAULT 0,
  "invoicedQty"            DOUBLE PRECISION NOT NULL DEFAULT 0,
  "invoicedAmount"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  "completedAt"            TIMESTAMP(3),
  "createdById"            TEXT NOT NULL,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkOrder_workOrderNumber_key" ON "WorkOrder"("workOrderNumber");
CREATE UNIQUE INDEX "WorkOrder_ionNumber_key" ON "WorkOrder"("ionNumber");
CREATE INDEX "WorkOrder_assignedUnitId_idx" ON "WorkOrder"("assignedUnitId");
CREATE INDEX "WorkOrder_status_idx" ON "WorkOrder"("status");
CREATE INDEX "WorkOrder_pdcDate_idx" ON "WorkOrder"("pdcDate");

ALTER TABLE "WorkOrder"
  ADD CONSTRAINT "WorkOrder_assignedUnitId_fkey"
  FOREIGN KEY ("assignedUnitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorkOrder"
  ADD CONSTRAINT "WorkOrder_unitAcceptedById_fkey"
  FOREIGN KEY ("unitAcceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorkOrder"
  ADD CONSTRAINT "WorkOrder_adminAcceptedById_fkey"
  FOREIGN KEY ("adminAcceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorkOrder"
  ADD CONSTRAINT "WorkOrder_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── WorkOrderExtension ────────────────────────────────────────────────
CREATE TABLE "WorkOrderExtension" (
  "id"           TEXT NOT NULL,
  "workOrderId"  TEXT NOT NULL,
  "extensionNo"  INTEGER NOT NULL,
  "newPdcDate"   TIMESTAMP(3) NOT NULL,
  "reason"       TEXT,
  "grantedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "grantedById"  TEXT,
  CONSTRAINT "WorkOrderExtension_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkOrderExtension_workOrderId_extensionNo_key"
  ON "WorkOrderExtension"("workOrderId", "extensionNo");
CREATE INDEX "WorkOrderExtension_workOrderId_idx" ON "WorkOrderExtension"("workOrderId");

ALTER TABLE "WorkOrderExtension"
  ADD CONSTRAINT "WorkOrderExtension_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkOrderExtension"
  ADD CONSTRAINT "WorkOrderExtension_grantedById_fkey"
  FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── WorkOrderInvoice ──────────────────────────────────────────────────
CREATE TABLE "WorkOrderInvoice" (
  "id"           TEXT NOT NULL,
  "workOrderId"  TEXT NOT NULL,
  "invoiceNo"    TEXT NOT NULL,
  "invoiceDate"  TIMESTAMP(3) NOT NULL,
  "quantity"     DOUBLE PRECISION NOT NULL,
  "amount"       DOUBLE PRECISION,
  "remarks"      TEXT,
  "createdById"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkOrderInvoice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkOrderInvoice_workOrderId_idx" ON "WorkOrderInvoice"("workOrderId");

ALTER TABLE "WorkOrderInvoice"
  ADD CONSTRAINT "WorkOrderInvoice_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkOrderInvoice"
  ADD CONSTRAINT "WorkOrderInvoice_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
