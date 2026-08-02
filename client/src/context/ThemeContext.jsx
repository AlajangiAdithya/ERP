import { createContext, useContext, useEffect, useMemo, useState } from 'react';

// ─── Appearance (light / dark / follow-system) ───
// The whole UI retints from one class on <html> — every colour utility in the
// app resolves through the CSS variables in src/theme.css. Nothing else needs
// to know which theme is active.
//
// The choice is a device preference, not account data: it lives in
// localStorage so it survives logout and never round-trips to the server.
// index.html applies the stored value before first paint (no white flash), and
// this provider keeps it in sync afterwards.

const STORAGE_KEY = 'raps-theme';
const THEME_COLORS = { light: '#1B3A6B', dark: '#0B111D' }; // mobile browser chrome

const ThemeContext = createContext(null);

const systemPrefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;

const readStored = () => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
};

export function ThemeProvider({ children }) {
  // 'light' | 'dark' | 'system' — what the user chose.
  const [preference, setPreference] = useState(readStored);
  // What that resolves to right now.
  const [resolved, setResolved] = useState(() =>
    (readStored() === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : readStored()));

  useEffect(() => {
    const apply = () => {
      const next = preference === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : preference;
      document.documentElement.classList.toggle('dark', next === 'dark');
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[next]);
      setResolved(next);
    };
    apply();
    try { localStorage.setItem(STORAGE_KEY, preference); } catch { /* private mode — session only */ }

    if (preference !== 'system') return undefined;
    // Follow the OS while "System" is selected.
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [preference]);

  const value = useMemo(
    () => ({
      preference,
      theme: resolved,
      isDark: resolved === 'dark',
      setTheme: setPreference,
      toggleTheme: () => setPreference(resolved === 'dark' ? 'light' : 'dark'),
    }),
    [preference, resolved],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
