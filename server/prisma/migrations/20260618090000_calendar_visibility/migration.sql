-- Calendar event visibility.
-- PERSONAL (default) — only the owner sees it.
-- EVERYONE — shared with all users; only the owner can edit/delete it.
-- Idempotent: safe to re-run.

ALTER TABLE "CalendarEvent"
    ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'PERSONAL';
