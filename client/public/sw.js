// Bump this on every deploy that needs to invalidate clients.
// Browsers detect any byte change in /sw.js and trigger reinstall.
const SW_VERSION = '2026-05-26-square-app-icons';

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
