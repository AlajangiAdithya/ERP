import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import api from '../api/axios';
import { useAuth } from './AuthContext';
import { ensurePushSubscription } from '../utils/push';

const NotificationContext = createContext(null);

const POLL_INTERVAL_MS = 5000;
const SOUND_URL = '/notification.mp3';
const PUSH_ICON = '/rapslogo6-app.png';

export function NotificationProvider({ children }) {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  const knownIdsRef = useRef(new Set());
  const firstFetchRef = useRef(true);
  const audioRef = useRef(null);
  const audioUnlockedRef = useRef(false);

  useEffect(() => {
    const audio = new Audio(SOUND_URL);
    audio.preload = 'auto';
    audio.volume = 0.85;
    audioRef.current = audio;

    const unlock = () => {
      if (audioUnlockedRef.current) return;
      const a = audioRef.current;
      if (a) {
        const prevVol = a.volume;
        a.volume = 0;
        a.play()
          .then(() => {
            a.pause();
            a.currentTime = 0;
            a.volume = prevVol;
            audioUnlockedRef.current = true;
          })
          .catch(() => { a.volume = prevVol; });
      }
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission()
          .then((perm) => {
            // Register this device for server push the moment permission lands
            // (guarded: only while a session exists).
            if (perm === 'granted' && localStorage.getItem('accessToken')) ensurePushSubscription();
          })
          .catch((e) => {
            if (import.meta.env.DEV) console.warn('[notify] requestPermission failed', e);
          });
      }
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };

    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const playSound = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    try {
      a.currentTime = 0;
      a.play().catch((e) => {
        if (import.meta.env.DEV) console.warn('[notify] play() rejected', e);
      });
    } catch (e) {
      if (import.meta.env.DEV) console.warn('[notify] play() threw', e);
    }
  }, []);

  const showPush = useCallback((n) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    const title = n.title || 'New notification';
    const opts = {
      body: n.message || '',
      icon: PUSH_ICON,
      tag: `raps-${n.id}`, // same tag as server push — never shows duplicates
      renotify: true,
    };
    // Android Chrome forbids page-context `new Notification` — go through the
    // service worker (clicks are handled by its notificationclick handler).
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.ready
        .then((reg) => reg.showNotification(title, opts))
        .catch(() => {});
      return;
    }
    try {
      const note = new Notification(title, opts);
      note.onclick = () => {
        window.focus();
        note.close();
      };
    } catch {}
  }, []);

  // Each login (or page load with a live session) re-registers this device for
  // server push, so notifications reach the OS tray even when the app is closed.
  useEffect(() => {
    if (!user) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    ensurePushSubscription();
  }, [user]);

  useEffect(() => {
    if (!user) {
      knownIdsRef.current = new Set();
      firstFetchRef.current = true;
      setUnreadCount(0);
      return;
    }

    let alive = true;

    const poll = async () => {
      try {
        const { data } = await api.get('/alerts/notifications', { params: { page: 1, limit: 20 } });
        if (!alive) return;

        const notifications = data.notifications || [];
        setUnreadCount(data.unreadCount ?? data.total ?? notifications.length);

        const currentIds = new Set(notifications.map(n => n.id));
        if (firstFetchRef.current) {
          knownIdsRef.current = currentIds;
          firstFetchRef.current = false;
        } else {
          const newOnes = notifications.filter(n => !knownIdsRef.current.has(n.id));
          if (newOnes.length > 0) {
            playSound();
            newOnes.slice(0, 3).forEach(showPush);
          }
          knownIdsRef.current = currentIds;
        }
      } catch {
        // network blip — swallow and try again next tick
      }
      // Auto-reload of consumer tables intentionally disabled — the polling
      // here still powers unread badge + sound + push, but pages must reload
      // their own data via tab/filter changes or an explicit Refresh button.
    };

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible') poll();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user, playSound, showPush]);

  return (
    <NotificationContext.Provider value={{ unreadCount }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotificationCenter() {
  return useContext(NotificationContext) || { unreadCount: 0 };
}

// Auto-refresh hook is kept as a no-op for backward compatibility with
// pages that still list it in their effect dependencies. It always returns
// the same value, so referencing it never triggers a re-fetch.
export function useAutoRefresh() {
  return 0;
}
