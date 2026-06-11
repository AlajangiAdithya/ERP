// ──────────────────────────────────────────────────────────────
// Team Chat — primary in-house messaging channel (shown on every dashboard).
// Replaces ad-hoc WhatsApp coordination.
//
//   @everyone <text>   → broadcast, every signed-in user sees it
//   @username  <text>  → direct message, only sender + recipient see it
//
// Only the sender can delete (soft) their own message once the work is done.
// Deleted messages stay visible in the "history" view (deletedAt set).
// Visible to every authenticated role (no authorize gate).
// ──────────────────────────────────────────────────────────────
const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { paginate } = require('../utils/helpers');

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
// Every active user except SUPERADMIN (hidden) and the caller themselves.
router.get('/recipients', authenticate, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        role: { not: 'SUPERADMIN' },
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
        where: { isActive: true, role: { not: 'SUPERADMIN' } },
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

// ── DELETE /api/messages/:id — sender-only soft delete ──
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const existing = await prisma.message.findUnique({
      where: { id: req.params.id },
      select: { id: true, senderId: true, deletedAt: true },
    });
    if (!existing) return res.status(404).json({ error: 'Message not found' });
    if (existing.senderId !== req.user.id) {
      return res.status(403).json({ error: 'Only the sender can delete this message' });
    }
    if (existing.deletedAt) {
      return res.status(400).json({ error: 'Message already deleted' });
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
