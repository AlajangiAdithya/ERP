// ──────────────────────────────────────────────────────────────
// Personal Calendar — private per-user events / reminders.
// Every row is owned by req.user; no cross-user visibility, no roles.
// Recurring events are stored once and expanded into occurrences on
// read, within the requested [from, to] window. Editing/deleting a
// recurring event affects the whole series (v1).
// ──────────────────────────────────────────────────────────────
const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const RECURRENCES = ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
const COLORS = ['blue', 'green', 'red', 'amber', 'purple', 'pink', 'teal', 'gray'];

const DAY_MS = 24 * 60 * 60 * 1000;

const addMonths = (date, n) => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
};
const addYears = (date, n) => {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + n);
  return d;
};

// End-of-day for the recurUntil cutoff so the last day fires fully.
const endOfDay = (date) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

// Expand one stored event into the occurrences that overlap [from, to].
// Returns plain occurrence objects carrying the base event id.
function expandEvent(ev, from, to) {
  const duration = new Date(ev.endAt).getTime() - new Date(ev.startAt).getTime();
  const baseStart = new Date(ev.startAt);
  const out = [];

  const overlaps = (s) => {
    const e = new Date(s.getTime() + duration);
    return s.getTime() <= to.getTime() && e.getTime() >= from.getTime();
  };
  const push = (s) => {
    out.push({
      id: ev.id,
      title: ev.title,
      description: ev.description,
      location: ev.location,
      allDay: ev.allDay,
      category: ev.category,
      color: ev.color,
      recurrence: ev.recurrence,
      recurUntil: ev.recurUntil,
      // occurrence window (may differ from the stored base for recurring)
      start: s.toISOString(),
      end: new Date(s.getTime() + duration).toISOString(),
      // the stored anchor — used by the client when opening for edit
      baseStart: ev.startAt,
      baseEnd: ev.endAt,
    });
  };

  if (ev.recurrence === 'NONE' || !RECURRENCES.includes(ev.recurrence)) {
    if (overlaps(baseStart)) push(baseStart);
    return out;
  }

  // Hard stop = min(window end, recurUntil end-of-day) for the recurring tail.
  const seriesEnd = ev.recurUntil
    ? Math.min(to.getTime(), endOfDay(ev.recurUntil).getTime())
    : to.getTime();
  if (baseStart.getTime() > seriesEnd) return out;

  let cursor = new Date(baseStart);

  // Fast-forward day-based steps close to the window start so we don't
  // walk years of daily occurrences one-by-one.
  if (cursor.getTime() < from.getTime()) {
    if (ev.recurrence === 'DAILY' || ev.recurrence === 'WEEKLY') {
      const step = ev.recurrence === 'DAILY' ? DAY_MS : 7 * DAY_MS;
      const gap = from.getTime() - cursor.getTime();
      const skip = Math.floor(gap / step);
      cursor = new Date(cursor.getTime() + skip * step);
    } else if (ev.recurrence === 'YEARLY') {
      const years = from.getFullYear() - cursor.getFullYear() - 1;
      if (years > 0) cursor = addYears(cursor, years);
    }
    // MONTHLY: walk month-by-month below (cheap enough for any window).
  }

  let guard = 0;
  while (cursor.getTime() <= seriesEnd && guard < 2000) {
    guard += 1;
    if (overlaps(cursor)) push(cursor);
    if (ev.recurrence === 'DAILY') cursor = new Date(cursor.getTime() + DAY_MS);
    else if (ev.recurrence === 'WEEKLY') cursor = new Date(cursor.getTime() + 7 * DAY_MS);
    else if (ev.recurrence === 'MONTHLY') cursor = addMonths(cursor, 1);
    else if (ev.recurrence === 'YEARLY') cursor = addYears(cursor, 1);
    else break;
  }
  return out;
}

// Normalise + validate a create/update payload. Returns { data } or { error }.
function buildEventData(body) {
  const title = (body.title || '').trim();
  if (!title) return { error: 'Title is required' };

  if (!body.startAt) return { error: 'Start date/time is required' };
  const startAt = new Date(body.startAt);
  if (Number.isNaN(startAt.getTime())) return { error: 'Invalid start date/time' };

  let endAt = body.endAt ? new Date(body.endAt) : new Date(startAt);
  if (Number.isNaN(endAt.getTime())) return { error: 'Invalid end date/time' };
  if (endAt.getTime() < startAt.getTime()) endAt = new Date(startAt);

  const recurrence = RECURRENCES.includes(body.recurrence) ? body.recurrence : 'NONE';
  const color = COLORS.includes(body.color) ? body.color : 'blue';

  let recurUntil = null;
  if (recurrence !== 'NONE' && body.recurUntil) {
    const ru = new Date(body.recurUntil);
    if (!Number.isNaN(ru.getTime())) recurUntil = ru;
  }

  return {
    data: {
      title,
      description: body.description ? String(body.description).trim() : null,
      location: body.location ? String(body.location).trim() : null,
      startAt,
      endAt,
      allDay: !!body.allDay,
      category: body.category ? String(body.category).trim() : null,
      color,
      recurrence,
      recurUntil,
    },
  };
}

// GET /api/calendar/events?from=&to=
// Returns occurrences overlapping the window (defaults to a wide window).
router.get('/events', authenticate, async (req, res) => {
  try {
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 366 * DAY_MS);
    const to = req.query.to ? new Date(req.query.to) : new Date(Date.now() + 366 * DAY_MS);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return res.status(400).json({ error: 'Invalid from/to range' });
    }

    // Pull every event that *could* touch the window: non-recurring ones that
    // overlap, plus all recurring ones that start on/before the window end
    // (their tail may reach into it). Expansion below filters precisely.
    const events = await prisma.calendarEvent.findMany({
      where: {
        ownerId: req.user.id,
        OR: [
          { recurrence: 'NONE', startAt: { lte: to }, endAt: { gte: from } },
          { recurrence: { not: 'NONE' }, startAt: { lte: to } },
        ],
      },
    });

    const occurrences = [];
    for (const ev of events) occurrences.push(...expandEvent(ev, from, to));
    occurrences.sort((a, b) => new Date(a.start) - new Date(b.start));

    res.json({ events: occurrences });
  } catch (error) {
    console.error('List calendar events error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/calendar/events — create
router.post('/events', authenticate, async (req, res) => {
  try {
    const { data, error } = buildEventData(req.body);
    if (error) return res.status(400).json({ error });

    const event = await prisma.calendarEvent.create({
      data: { ...data, ownerId: req.user.id },
    });
    res.status(201).json(event);
  } catch (error) {
    console.error('Create calendar event error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/calendar/events/:id — update (owner only). Edits the whole series.
router.put('/events/:id', authenticate, async (req, res) => {
  try {
    const existing = await prisma.calendarEvent.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.ownerId !== req.user.id) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const { data, error } = buildEventData(req.body);
    if (error) return res.status(400).json({ error });

    const event = await prisma.calendarEvent.update({
      where: { id: req.params.id },
      data,
    });
    res.json(event);
  } catch (error) {
    console.error('Update calendar event error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/calendar/events/:id — delete (owner only). Removes the whole series.
router.delete('/events/:id', authenticate, async (req, res) => {
  try {
    const existing = await prisma.calendarEvent.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.ownerId !== req.user.id) {
      return res.status(404).json({ error: 'Event not found' });
    }
    await prisma.calendarEvent.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete calendar event error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
