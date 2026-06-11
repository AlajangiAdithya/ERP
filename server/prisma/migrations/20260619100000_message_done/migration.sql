-- Team Chat — work closure ("Done") on direct messages.
--
-- A direct message (@username) is usually someone asking another user to do
-- some work. The recipient closes it by clicking "Done", which stamps doneAt.
-- Only after that may the sender delete (soft-delete) the message. Broadcasts
-- (@everyone) never carry a doneAt — there is no single recipient to close them.
-- Idempotent: safe to re-run.

ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "doneAt" TIMESTAMP(3);
