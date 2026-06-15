const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { getPublicKey, enabled, countSubscriptions, sendTestToUser } = require('../services/push');

const router = express.Router();

// GET /api/push/public-key — VAPID public key the browser needs to subscribe
router.get('/public-key', authenticate, (req, res) => {
  const key = getPublicKey();
  if (!key) return res.status(503).json({ error: 'Push not configured' });
  res.json({ key });
});

// GET /api/push/status — is push configured on the server, and how many devices
// has this user registered? Powers the "Notifications" settings UI.
router.get('/status', authenticate, async (req, res) => {
  try {
    const devices = await countSubscriptions(prisma, req.user.id);
    res.json({ enabled, devices });
  } catch (error) {
    console.error('Push status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/push/test — send a test push to the current user's devices and
// report how many were reached, so a device can verify push works end to end.
router.post('/test', authenticate, async (req, res) => {
  try {
    const result = await sendTestToUser(prisma, req.user.id);
    res.json(result);
  } catch (error) {
    console.error('Push test error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/push/subscribe — register this browser/device for the logged-in user
router.post('/subscribe', authenticate, async (req, res) => {
  try {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'Invalid subscription' });
    }
    // Upsert on endpoint: same device re-subscribing (or a different user
    // logging in on it) just re-points the row instead of erroring.
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { userId: req.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
      update: { userId: req.user.id, p256dh: keys.p256dh, auth: keys.auth },
    });
    res.status(201).json({ message: 'Subscribed' });
  } catch (error) {
    console.error('Push subscribe error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/push/unsubscribe — called on logout so a shared device stops
// receiving the previous user's notifications
router.post('/unsubscribe', authenticate, async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
    await prisma.pushSubscription.deleteMany({ where: { endpoint } });
    res.json({ message: 'Unsubscribed' });
  } catch (error) {
    console.error('Push unsubscribe error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
