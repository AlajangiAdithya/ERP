// Web Push delivery. Mirrors every in-app Notification row out to the
// browsers/devices that registered a PushSubscription, so users get OS-level
// notifications (phone tray, desktop) even when the ERP tab is closed.
//
// Wired up as a Prisma middleware in config/db.js — any
// prisma.notification.create / createMany anywhere in the codebase
// automatically triggers a push. No call site needs to know about this module.
const webpush = require('web-push');
const { notificationRoute } = require('../utils/notificationRoutes');

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

const enabled = Boolean(PUBLIC_KEY && PRIVATE_KEY);
if (enabled) {
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
  console.log('[push] web push enabled (VAPID configured)');
} else {
  console.warn('[push] VAPID keys not set — web push disabled. Set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.');
}

// Resolve which subscriptions a notification should reach, matching the same
// targeting rules the GET /api/alerts/notifications endpoint uses:
// targetUserId → that user; targetRole → all active users with the role;
// neither → everyone.
async function subscriptionsFor(prisma, notif) {
  if (notif.targetUserId) {
    return prisma.pushSubscription.findMany({ where: { userId: notif.targetUserId } });
  }
  if (notif.targetRole) {
    return prisma.pushSubscription.findMany({
      where: { user: { role: notif.targetRole, isActive: true } },
    });
  }
  return prisma.pushSubscription.findMany({ where: { user: { isActive: true } } });
}

// Sends one push. Returns { ok, statusCode?, error? } so callers can tally
// results — never throws.
async function deliver(prisma, sub, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
      { TTL: 60 * 60 * 24 }
    );
    return { ok: true };
  } catch (err) {
    const statusCode = err.statusCode;
    // 404/410 — endpoint is dead (uninstalled app, cleared site data). Prune it.
    if (statusCode === 404 || statusCode === 410) {
      await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
      return { ok: false, statusCode, error: 'gone (pruned)' };
    }
    // 400/403 usually means the subscription was made with a *different* VAPID
    // key than the server now holds (keys were rotated). The client can't fix
    // this until it re-subscribes, which it does on its next load.
    console.error('[push] send failed:', statusCode || err.message);
    return { ok: false, statusCode, error: err.body || err.message };
  }
}

function buildPayload(notif) {
  return JSON.stringify({
    id: notif.id || null,
    title: notif.title || 'RAPS ERP',
    message: notif.message || '',
    type: notif.type || 'GENERAL',
    url: notificationRoute(notif.type),
  });
}

// Fire-and-forget: never let a push failure break the request that created
// the notification. `notifs` is one or more rows shaped like the
// Notification model (works for both create and createMany data).
function sendForNotifications(prisma, notifs) {
  if (!enabled) return;
  const rows = Array.isArray(notifs) ? notifs : [notifs];

  setImmediate(async () => {
    for (const notif of rows) {
      try {
        const subs = await subscriptionsFor(prisma, notif);
        if (!subs.length) continue;
        const payload = buildPayload(notif);
        const results = await Promise.all(subs.map((sub) => deliver(prisma, sub, payload)));
        const sent = results.filter((r) => r.ok).length;
        console.log(`[push] "${notif.title || 'notification'}" → ${sent}/${subs.length} devices`);
      } catch (err) {
        console.error('[push] notification fan-out failed:', err.message);
      }
    }
  });
}

// On-demand test: pushes a notification to a single user's devices and reports
// exactly what happened, so a device/operator can confirm push works end to end.
async function sendTestToUser(prisma, userId) {
  if (!enabled) {
    return { enabled: false, total: 0, sent: 0, failed: 0, errors: ['VAPID keys not configured on server'] };
  }
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (!subs.length) {
    return { enabled: true, total: 0, sent: 0, failed: 0, errors: ['No devices registered for this account'] };
  }
  const payload = buildPayload({
    title: 'RAPS ERP — test',
    message: 'Push notifications are working on this device.',
    type: 'TEST',
  });
  const results = await Promise.all(subs.map((sub) => deliver(prisma, sub, payload)));
  const sent = results.filter((r) => r.ok).length;
  const errors = results.filter((r) => !r.ok).map((r) => `${r.statusCode || ''} ${r.error || ''}`.trim());
  return { enabled: true, total: subs.length, sent, failed: subs.length - sent, errors };
}

async function countSubscriptions(prisma, userId) {
  return prisma.pushSubscription.count({ where: { userId } });
}

module.exports = {
  sendForNotifications,
  sendTestToUser,
  countSubscriptions,
  getPublicKey: () => PUBLIC_KEY || null,
  enabled,
};
