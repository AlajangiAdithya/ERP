-- Machinery + Fire Extinguisher registers (SAFETY / Unit-5 owned)

-- ── Machinery ──
CREATE TABLE "Machinery" (
    "id" TEXT NOT NULL,
    "serialNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" TEXT,
    "makeModel" TEXT,
    "machineSerialNo" TEXT,
    "rapsId" TEXT NOT NULL,
    "place" TEXT,
    "remarks" TEXT,
    "amcStatus" TEXT,
    "amcVendor" TEXT,
    "amcExpiry" TIMESTAMP(3),
    "amcAttachment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    CONSTRAINT "Machinery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Machinery_rapsId_key" ON "Machinery"("rapsId");
CREATE INDEX "Machinery_serialNumber_idx" ON "Machinery"("serialNumber");
CREATE INDEX "Machinery_place_idx" ON "Machinery"("place");

ALTER TABLE "Machinery" ADD CONSTRAINT "Machinery_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Fire Extinguishers ──
CREATE TABLE "FireExtinguisher" (
    "id" TEXT NOT NULL,
    "serialNumber" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "capacity" TEXT NOT NULL,
    "rapsId" TEXT NOT NULL,
    "refilledOn" TIMESTAMP(3),
    "nextDueOn" TIMESTAMP(3),
    "unit" TEXT NOT NULL,
    "location" TEXT,
    "attachment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    CONSTRAINT "FireExtinguisher_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FireExtinguisher_rapsId_key" ON "FireExtinguisher"("rapsId");
CREATE INDEX "FireExtinguisher_unit_idx" ON "FireExtinguisher"("unit");
CREATE INDEX "FireExtinguisher_nextDueOn_idx" ON "FireExtinguisher"("nextDueOn");

ALTER TABLE "FireExtinguisher" ADD CONSTRAINT "FireExtinguisher_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
