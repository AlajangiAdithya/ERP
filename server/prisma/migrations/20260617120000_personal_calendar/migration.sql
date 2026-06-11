-- Personal Calendar — private per-user events / reminders.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS "CalendarEvent" (
    "id"          TEXT NOT NULL,
    "ownerId"     TEXT NOT NULL,
    "title"       TEXT NOT NULL,
    "description" TEXT,
    "location"    TEXT,
    "startAt"     TIMESTAMP(3) NOT NULL,
    "endAt"       TIMESTAMP(3) NOT NULL,
    "allDay"      BOOLEAN NOT NULL DEFAULT false,
    "category"    TEXT,
    "color"       TEXT NOT NULL DEFAULT 'blue',
    "recurrence"  TEXT NOT NULL DEFAULT 'NONE',
    "recurUntil"  TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CalendarEvent_ownerId_startAt_idx"
    ON "CalendarEvent"("ownerId", "startAt");

DO $$ BEGIN
  ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
