import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import api from '../api/axios';
import { useAuth } from './AuthContext';

const NotificationContext = createContext(null);

const POLL_INTERVAL_MS = 5000;
const SOUND_URL = '/notification.mp3';
const PUSH_ICON = '/rapslogo6-app.png';

export function NotificationProvider({ children }) {
  const { user } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);
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
        Notification.requestPermission().catch(() => {});
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
      a.play().catch(() => {});
    } catch {}
  }, []);

  const showPush = useCallback((n) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    try {
      const note = new Notification(n.title || 'New notification', {
        body: n.message || '',
        icon: PUSH_ICON,
        tag: `raps-${n.id}`,
        renotify: true,
      });
      note.onclick = () => {
        window.focus();
        note.close();
      };
    } catch {}
  }, []);

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
        setUnreadCount(data.total ?? notifications.length);

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
      if (alive) setRefreshKey(k => k + 1);
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
    <NotificationContext.Provider value={{ refreshKey, unreadCount }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotificationCenter() {
  return useContext(NotificationContext) || { refreshKey: 0, unreadCount: 0 };
}

export function useAutoRefresh() {
  return useNotificationCenter().refreshKey;
}
