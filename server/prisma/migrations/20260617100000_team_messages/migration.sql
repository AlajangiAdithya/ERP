-- Team Chat — in-house messaging channel shown on every dashboard.
--
-- A message is either a broadcast (`@everyone`, isBroadcast = true, recipientId
-- null) seen by all users, or a direct message (`@username`, recipientId set)
-- seen only by sender + recipient. The sender soft-deletes a message once the
-- work is done (deletedAt set): the row is retained for the "deleted history"
-- view but drops out of the active feed.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS "Message" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "isBroadcast" BOOLEAN NOT NULL DEFAULT false,
    "recipientId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Message_isBroadcast_createdAt_idx" ON "Message"("isBroadcast", "createdAt");
CREATE INDEX IF NOT EXISTS "Message_recipientId_createdAt_idx" ON "Message"("recipientId", "createdAt");
CREATE INDEX IF NOT EXISTS "Message_senderId_createdAt_idx" ON "Message"("senderId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey"
    FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_recipientId_fkey"
    FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
