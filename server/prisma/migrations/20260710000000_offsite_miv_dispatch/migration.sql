-- OFFSITE MIV DISPATCH
-- Offsite units (ANSP, CPDC, Adibatla, ASL, RCI, IBRPTM) get a distinct MIV path:
-- ADMIN approves (and may edit qty) → central store dispatches material out on
-- NON_RETURNABLE gate passes → the offsite unit's MANAGER acks receipt. This adds
-- the offsite flag, per-line dispatched-qty tracking, and the MIV↔GatePass bridge.

-- 1. Flag a unit as offsite.
ALTER TABLE "Unit" ADD COLUMN IF NOT EXISTS "isOffsite" BOOLEAN NOT NULL DEFAULT false;

-- 2. Cumulative dispatched qty per MIV line (offsite flow only).
ALTER TABLE "RequestItem" ADD COLUMN IF NOT EXISTS "dispatchedQty" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- 3. Many-to-many bridge: one GP line can fulfil one offsite MIV line (partial),
--    one MIV line is fulfilled across many GP lines.
CREATE TABLE IF NOT EXISTS "GatePassMivLink" (
    "id" TEXT NOT NULL,
    "gatePassItemId" TEXT NOT NULL,
    "requestItemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GatePassMivLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GatePassMivLink_gatePassItemId_idx" ON "GatePassMivLink"("gatePassItemId");
CREATE INDEX IF NOT EXISTS "GatePassMivLink_requestItemId_idx" ON "GatePassMivLink"("requestItemId");

ALTER TABLE "GatePassMivLink"
    ADD CONSTRAINT "GatePassMivLink_gatePassItemId_fkey"
    FOREIGN KEY ("gatePassItemId") REFERENCES "GatePassItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GatePassMivLink"
    ADD CONSTRAINT "GatePassMivLink_requestItemId_fkey"
    FOREIGN KEY ("requestItemId") REFERENCES "RequestItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Seed the six known offsite units (idempotent; matches name or code).
UPDATE "Unit"
   SET "isOffsite" = true
 WHERE UPPER("name") IN ('ANSP', 'CPDC', 'ADIBATLA', 'ASL', 'RCI', 'IBRPTM')
    OR UPPER("code") IN ('ANSP', 'CPDC', 'ADIBATLA', 'ASL', 'RCI', 'IBRPTM');
