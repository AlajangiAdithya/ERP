// Bump this on every deploy that needs to invalidate clients.
// Browsers detect any byte change in /sw.js and trigger reinstall.
const SW_VERSION = '2026-06-12-web-push';

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
  event.waitUntil(self.registration.showNotification(title, {
    body: data.message || '',
    icon: '/app-icon-192.png',
    badge: '/app-icon-192.png',
    tag: data.id ? `raps-${data.id}` : undefined,
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        try { await client.focus(); return; } catch (_) {}
      }
    }
    await self.clients.openWindow(url);
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
