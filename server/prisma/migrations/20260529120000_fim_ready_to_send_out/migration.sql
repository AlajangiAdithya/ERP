-- Two-step FIM return: unit manager marks the batch ready to send back,
-- then Stores can create the outward gate pass. Send-out is blocked
-- until readyToSendOutAt is set.

ALTER TABLE "ProductBatch"
  ADD COLUMN "readyToSendOutAt"   TIMESTAMP(3),
  ADD COLUMN "readyToSendOutById" TEXT,
  ADD COLUMN "readyToSendOutNote" TEXT;

ALTER TABLE "ProductBatch"
  ADD CONSTRAINT "ProductBatch_readyToSendOutById_fkey"
    FOREIGN KEY ("readyToSendOutById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
