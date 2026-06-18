// Bump this on every deploy that needs to invalidate clients.
// Browsers detect any byte change in /sw.js and trigger reinstall.
const SW_VERSION = '2026-06-18-notif-routing';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    const windows = await self.clients.matchAll({ type: 'window' });
    windows.forEach((c) => {
      try { c.navigate(c.url); } catch (_) {}
    });
  })());
});

// ── Web Push ──────────────────────────────────────────
// Server mirrors every in-app notification out via web-push; this shows it
// in the OS notification tray (phone + desktop), even with the app closed.
// Tag matches the in-page poll notification (`raps-<id>`) so the user never
// sees the same notification twice when the app is open.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  const title = data.title || 'RAPS ERP';
  event.waitUntil((async () => {
    // If the app is already open and focused, the in-page toast handles it —
    // skip the OS notification so the user isn't alerted twice.
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const appFocused = windows.some((c) => c.focused || c.visibilityState === 'visible');
    if (appFocused) return;

    await self.registration.showNotification(title, {
      body: data.message || '',
      icon: '/app-icon-192.png',
      badge: '/app-icon-192.png',
      tag: data.id ? `raps-${data.id}` : undefined,
      renotify: Boolean(data.id),
      // Keep the notification in the OS tray until the user acts on it (like
      // WhatsApp/Slack) instead of auto-dismissing after a few seconds.
      requireInteraction: true,
      silent: false, // let the OS play its notification sound
      data: { url: data.url || '/' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  const targetHref = new URL(target, self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      try {
        // Already on the right page → just focus it.
        if (client.url === targetHref) {
          if ('focus' in client) { await client.focus(); return; }
        }
        // Otherwise reuse this tab: send it to the notification's page, then
        // focus — so the click always lands on the respective page, not on
        // whatever the tab happened to be showing.
        if ('navigate' in client) {
          const navigated = await client.navigate(target).catch(() => null);
          const c = navigated || client;
          if ('focus' in c) { await c.focus(); return; }
        } else if ('focus' in client) {
          await client.focus();
          return;
        }
      } catch (_) {
        // try the next client, else fall through to opening a fresh window
      }
    }
    await self.clients.openWindow(target);
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/assets/')) return;
  if (/\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|pdf)$/i.test(url.pathname)) return;
  event.respondWith(fetch(req, { cache: 'no-cache' }));
});
