import { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/axios';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('user');
    if (!saved) return null;
    try {
      return JSON.parse(saved);
    } catch {
      // Corrupted localStorage shouldn't softlock login — clear and continue.
      localStorage.removeItem('user');
      return null;
    }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    const cachedUser = localStorage.getItem('user');
    if (token || cachedUser) {
      api.get('/auth/me')
        .then(({ data }) => {
          setUser(data.user);
          localStorage.setItem('user', JSON.stringify(data.user));
        })
        .catch(() => {
          // Axios interceptor already tried /auth/refresh and gave up — the
          // refresh-token cookie is gone or invalid, so the session is truly
          // dead. Clearing here is the only auto-logout path; everything else
          // requires the user to click the logout button.
          setUser(null);
          localStorage.removeItem('accessToken');
          localStorage.removeItem('user');
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (username, password) => {
    const { data } = await api.post('/auth/login', { username, password });
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    return data;
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {}
    localStorage.removeItem('accessToken');
    localStorage.removeItem('user');
    // Drop any owner-impersonation stash so a fresh login starts clean.
    sessionStorage.removeItem('ownerAccessToken');
    sessionStorage.removeItem('ownerUser');
    setUser(null);
  };

  // ── Owner impersonation ───────────────────────────────
  // Stash the SUPERADMIN's own token in sessionStorage (cleared on tab close),
  // then swap the active token + user to the target. `returnToOwner` swaps back.
  const impersonate = async (targetUserId) => {
    const ownerToken = localStorage.getItem('accessToken');
    const ownerUserStr = localStorage.getItem('user');
    const { data } = await api.post(`/superadmin/users/${targetUserId}/impersonate`);
    if (ownerToken) sessionStorage.setItem('ownerAccessToken', ownerToken);
    if (ownerUserStr) sessionStorage.setItem('ownerUser', ownerUserStr);
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    return data;
  };

  const returnToOwner = () => {
    const ownerToken = sessionStorage.getItem('ownerAccessToken');
    const ownerUserStr = sessionStorage.getItem('ownerUser');
    if (!ownerToken || !ownerUserStr) return false;
    localStorage.setItem('accessToken', ownerToken);
    localStorage.setItem('user', ownerUserStr);
    sessionStorage.removeItem('ownerAccessToken');
    sessionStorage.removeItem('ownerUser');
    try { setUser(JSON.parse(ownerUserStr)); } catch { return false; }
    return true;
  };

  const isImpersonating = !!sessionStorage.getItem('ownerAccessToken');

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, impersonate, returnToOwner, isImpersonating }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
