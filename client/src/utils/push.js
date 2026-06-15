// Registers this browser/device for server-sent web push notifications.
// Safe to call repeatedly — resubscribing with the same key is a no-op and
// the server upserts on endpoint.
import api from '../api/axios';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

// True if an existing subscription was created with a *different* VAPID public
// key than the server now uses. After a key rotation the browser silently
// keeps the old subscription and the server can never deliver to it — so we
// detect the mismatch and force a fresh subscribe.
function keyMatches(subscription, serverKeyBytes) {
  const current = subscription.options?.applicationServerKey;
  if (!current) return false;
  const a = new Uint8Array(current);
  if (a.length !== serverKeyBytes.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== serverKeyBytes[i]) return false;
  return true;
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function pushPermission() {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

export async function ensurePushSubscription() {
  if (!pushSupported()) return false;
  if (Notification.permission !== 'granted') return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const { data } = await api.get('/push/public-key');
    const serverKeyBytes = urlBase64ToUint8Array(data.key);

    let subscription = await registration.pushManager.getSubscription();
    // Drop a stale subscription bound to an old VAPID key before re-creating.
    if (subscription && !keyMatches(subscription, serverKeyBytes)) {
      await subscription.unsubscribe().catch(() => {});
      subscription = null;
    }
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: serverKeyBytes,
      });
    }
    // Always re-send: ties the endpoint to whoever is logged in right now.
    await api.post('/push/subscribe', subscription.toJSON());
    return true;
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[push] subscribe failed', e);
    return false;
  }
}

// Explicit, user-initiated enable: ask for permission (if needed) then
// subscribe this device. Returns the resulting permission string so the UI
// can react ('granted' | 'denied' | 'default' | 'unsupported').
export async function enablePush() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch { /* user dismissed */ }
  }
  if (Notification.permission === 'granted') {
    await ensurePushSubscription();
  }
  return Notification.permission;
}

// Called on logout so a shared device stops getting the old user's pushes.
// Best-effort: must run while the auth token is still valid.
export async function removePushSubscription() {
  if (!pushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await api.post('/push/unsubscribe', { endpoint: subscription.endpoint });
    }
  } catch {}
}
