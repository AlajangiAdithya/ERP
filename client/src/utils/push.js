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

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function ensurePushSubscription() {
  if (!pushSupported()) return false;
  if (Notification.permission !== 'granted') return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const { data } = await api.get('/push/public-key');
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.key),
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
