// ──────────────────────────────────────────────────────────────
// Team Chat — primary in-house messaging channel (shown on every dashboard).
// Replaces ad-hoc WhatsApp coordination.
//
//   @everyone <text>   → broadcast, every signed-in user sees it
//   @username  <text>  → direct message, only sender + recipient see it
//
// A direct message is usually a work request. The recipient closes it with the
// "Done" button (PATCH /:id/done → doneAt). Only then may the sender soft-delete
// it (DELETE /:id → deletedAt). Broadcasts have no recipient to close, so the
// sender may delete them at any time. Deleted messages stay visible in the
// "history" view. Visible to every authenticated role (no authorize gate).
// ──────────────────────────────────────────────────────────────
const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { paginate } = require('../utils/helpers');
const { HIDDEN_ROLES } = require('../utils/hiddenRoles');

const router = express.Router();

const MSG_INCLUDE = {
  sender:    { select: { id: true, name: true, username: true, role: true, unit: { select: { name: true, code: true } } } },
  recipient: { select: { id: true, name: true, username: true, role: true, unit: { select: { name: true, code: true } } } },
};

// Aliases that all mean "send to everyone".
const BROADCAST_TOKENS = ['everyone', 'all', 'channel', 'here'];

// Build the Prisma `where` that scopes messages to what this user may see:
// any broadcast, anything they sent, anything addressed to them.
const visibilityFilter = (userId) => ({
  OR: [
    { isBroadcast: true },
    { senderId: userId },
    { recipientId: userId },
  ],
});

// Strip the leading "@" and return everything after it. Resolution of the
// target (broadcast token vs a real username) happens in the POST handler
// because usernames may contain spaces — so we can NOT split on whitespace
// here. Returns { error } | { afterAt }.
const parseLeadingMention = (raw) => {
  const text = String(raw || '').trim();
  if (!text) return { error: 'Message cannot be empty' };
  if (!text.startsWith('@')) {
    return { error: 'Start your message with @everyone or @username' };
  }
  const afterAt = text.slice(1);
  if (!afterAt.trim()) return { error: 'Add a username or "everyone" after @' };
  return { afterAt };
};

// Does `afterAt` (already lowercased) begin with `name` on a word boundary?
// Boundary = end-of-string or a following space. Lets a username that itself
// contains spaces ("john doe") match without whitespace breaking the parse.
const mentionStartsWith = (lowerAfter, name) => {
  const n = name.toLowerCase();
  return lowerAfter === n || lowerAfter.startsWith(`${n} `);
};

// ── GET /api/messages — list visible messages ──
//   ?view=active (default) | deleted   ?page ?limit
router.get('/', authenticate, async (req, res) => {
  try {
    const { view, page, limit } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {
      AND: [
        visibilityFilter(req.user.id),
        view === 'deleted' ? { deletedAt: { not: null } } : { deletedAt: null },
      ],
    };

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where,
        include: MSG_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.message.count({ where }),
    ]);

    res.json({
      messages,
      total,
      page: Math.ceil(skip / take) + 1,
      totalPages: Math.ceil(total / take),
    });
  } catch (error) {
    console.error('List messages error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/messages/recipients — usernames for the @mention picker ──
// Every active user except hidden roles (SUPERADMIN, DATA_EDITOR) and the caller.
router.get('/recipients', authenticate, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        role: { notIn: HIDDEN_ROLES },
        NOT: { id: req.user.id },
      },
      select: {
        id: true, name: true, username: true, role: true,
        unit: { select: { name: true, code: true } },
      },
      orderBy: { username: 'asc' },
    });
    res.json(users);
  } catch (error) {
    console.error('List message recipients error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/messages — send a broadcast or direct message ──
//   body: { body: "@everyone ..." | "@username ..." }
router.post('/', authenticate, async (req, res) => {
  try {
    const parsed = parseLeadingMention(req.body?.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const afterAt = parsed.afterAt;
    const lowerAfter = afterAt.toLowerCase();
    let isBroadcast = false;
    let recipientId = null;
    let rest = null;

    // 1) Broadcast tokens (@everyone / @all / …).
    const bToken = BROADCAST_TOKENS.find((t) => mentionStartsWith(lowerAfter, t));
    if (bToken) {
      isBroadcast = true;
      rest = afterAt.slice(bToken.length).trim();
    } else {
      // 2) Match a real username. Usernames may contain spaces, so we compare
      // against the whole candidate list and keep the LONGEST one that the
      // text starts with on a word boundary. The remainder is the message.
      const candidates = await prisma.user.findMany({
        where: { isActive: true, role: { notIn: HIDDEN_ROLES } },
        select: { id: true, username: true },
      });
      let match = null;
      for (const c of candidates) {
        if (mentionStartsWith(lowerAfter, c.username)) {
          if (!match || c.username.length > match.username.length) match = c;
        }
      }
      if (!match) {
        const guess = afterAt.split(/\s+/)[0];
        return res.status(400).json({ error: `No active user matches @${guess}. Pick a name from the list, or use @everyone.` });
      }
      if (match.id === req.user.id) {
        return res.status(400).json({ error: 'You cannot message yourself' });
      }
      recipientId = match.id;
      rest = afterAt.slice(match.username.length).trim();
    }

    if (!rest) {
      return res.status(400).json({ error: 'Add a message after the @mention' });
    }

    const message = await prisma.message.create({
      data: {
        body: rest,
        senderId: req.user.id,
        isBroadcast,
        recipientId,
      },
      include: MSG_INCLUDE,
    });

    // Direct messages also drop a notification so the recipient gets the
    // bell + sound even if their dashboard tab isn't open. Broadcasts skip
    // this (every-user fan-out is wasteful) — the chat poll surfaces them.
    if (recipientId) {
      await prisma.notification.create({
        data: {
          type: 'MESSAGE_RECEIVED',
          title: `New message from ${req.user.name}`,
          message: rest.length > 140 ? `${rest.slice(0, 140)}…` : rest,
          targetUserId: recipientId,
          sentById: req.user.id,
        },
      });
    }

    res.status(201).json(message);
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/messages/:id/done — recipient marks the work done ──
// Only the recipient of a direct message can close it. Closing stamps doneAt,
// which unlocks the sender's delete button and notifies the sender.
router.patch('/:id/done', authenticate, async (req, res) => {
  try {
    const existing = await prisma.message.findUnique({
      where: { id: req.params.id },
      select: { id: true, isBroadcast: true, recipientId: true, senderId: true, doneAt: true, deletedAt: true, body: true },
    });
    if (!existing) return res.status(404).json({ error: 'Message not found' });
    if (existing.isBroadcast || !existing.recipientId) {
      return res.status(400).json({ error: 'Broadcasts cannot be marked done' });
    }
    if (existing.recipientId !== req.user.id) {
      return res.status(403).json({ error: 'Only the recipient can mark this done' });
    }
    if (existing.deletedAt) {
      return res.status(400).json({ error: 'Message already deleted' });
    }
    if (existing.doneAt) {
      return res.status(400).json({ error: 'Already marked done' });
    }

    const message = await prisma.message.update({
      where: { id: req.params.id },
      data: { doneAt: new Date() },
      include: MSG_INCLUDE,
    });

    // Let the sender know the work is closed so they can clear the message.
    const preview = existing.body.length > 120 ? `${existing.body.slice(0, 120)}…` : existing.body;
    await prisma.notification.create({
      data: {
        type: 'MESSAGE_DONE',
        title: `${req.user.name} marked your message done`,
        message: preview,
        targetUserId: existing.senderId,
        sentById: req.user.id,
      },
    });

    res.json(message);
  } catch (error) {
    console.error('Mark message done error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/messages/:id — sender-only soft delete ──
// A direct message can only be deleted once the recipient has marked it done.
// Broadcasts have no recipient to close them, so the sender may delete anytime.
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const existing = await prisma.message.findUnique({
      where: { id: req.params.id },
      select: { id: true, senderId: true, isBroadcast: true, recipientId: true, doneAt: true, deletedAt: true },
    });
    if (!existing) return res.status(404).json({ error: 'Message not found' });
    if (existing.senderId !== req.user.id) {
      return res.status(403).json({ error: 'Only the sender can delete this message' });
    }
    if (existing.deletedAt) {
      return res.status(400).json({ error: 'Message already deleted' });
    }
    const isDirect = !existing.isBroadcast && existing.recipientId;
    if (isDirect && !existing.doneAt) {
      return res.status(400).json({ error: 'Wait for the recipient to mark this done before deleting' });
    }

    const message = await prisma.message.update({
      where: { id: req.params.id },
      data: { deletedAt: new Date() },
      include: MSG_INCLUDE,
    });
    res.json(message);
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
