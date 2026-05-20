if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      // updateViaCache: 'none' — always hit the network for /sw.js itself,
      // never let the HTTP cache satisfy the SW lookup. Without this, a stale
      // /sw.js can sit in the HTTP cache and block updates indefinitely.
      const reg = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
      // Force an update check on every page load.
      reg.update().catch(() => {});
    } catch (_) {}
  });
}
