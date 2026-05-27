const express = require('express');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const prisma = require('../config/db');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { username },
      include: { unit: { select: { id: true, name: true, code: true } } },
    });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Session never expires on its own — only explicit logout (or admin
    // deactivation) ends it. expiresAt is set far in the future as a sentinel
    // since the schema requires it, but the /refresh handler no longer checks it.
    const FAR_FUTURE = new Date('9999-12-31T23:59:59Z');
    await prisma.session.create({
      data: { userId: user.id, refreshToken, expiresAt: FAR_FUTURE },
    });

    // Browsers cap cookie maxAge at ~400 days, but /refresh re-issues the
    // cookie on every token refresh, giving daily users a rolling renewal.
    const COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE_MS,
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'LOGIN',
        entity: 'User',
        entityId: user.id,
        ipAddress: req.ip,
      },
    });

    res.json({
      accessToken,
      user: {
        id: user.id, username: user.username, name: user.name, role: user.role,
        unitId: user.unitId, unit: user.unit,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  try {
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!token) {
      return res.status(401).json({ error: 'Refresh token required' });
    }

    const decoded = verifyRefreshToken(token);
    const session = await prisma.session.findUnique({ where: { refreshToken: token } });

    // Session row presence is the only kill switch — no time-based expiry check.
    if (!session) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    // Re-issue the cookie so its 400-day browser cap slides forward on every
    // refresh. Active users effectively get an indefinite session.
    const COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
    res.cookie('refreshToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE_MS,
    });

    const accessToken = generateAccessToken(user);
    res.json({ accessToken });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// POST /api/auth/logout
router.post('/logout', authenticate, async (req, res) => {
  try {
    const token = req.cookies?.refreshToken;
    if (token) {
      await prisma.session.deleteMany({ where: { refreshToken: token } });
    }

    res.clearCookie('refreshToken');

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'LOGOUT',
        entity: 'User',
        entityId: req.user.id,
        ipAddress: req.ip,
      },
    });

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
