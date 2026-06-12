// Web Push delivery. Mirrors every in-app Notification row out to the
// browsers/devices that registered a PushSubscription, so users get OS-level
// notifications (phone tray, desktop) even when the ERP tab is closed.
//
// Wired up as a Prisma middleware in config/db.js — any
// prisma.notification.create / createMany anywhere in the codebase
// automatically triggers a push. No call site needs to know about this module.
const webpush = require('web-push');

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

const enabled = Boolean(PUBLIC_KEY && PRIVATE_KEY);
if (enabled) {
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
} else {
  console.warn('[push] VAPID keys not set — web push disabled');
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

async function deliver(prisma, sub, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
      { TTL: 60 * 60 * 24 }
    );
  } catch (err) {
    // 404/410 — endpoint is dead (uninstalled app, cleared site data). Prune it.
    if (err.statusCode === 404 || err.statusCode === 410) {
      await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
    } else {
      console.error('[push] send failed:', err.statusCode || err.message);
    }
  }
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
        const payload = JSON.stringify({
          id: notif.id || null,
          title: notif.title || 'RAPS ERP',
          message: notif.message || '',
          type: notif.type || 'GENERAL',
          url: '/',
        });
        await Promise.all(subs.map((sub) => deliver(prisma, sub, payload)));
      } catch (err) {
        console.error('[push] notification fan-out failed:', err.message);
      }
    }
  });
}

module.exports = { sendForNotifications, getPublicKey: () => PUBLIC_KEY || null, enabled };
