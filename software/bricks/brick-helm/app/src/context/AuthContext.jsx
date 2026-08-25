import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  getMe,
  login as apiLogin,
  logout as apiLogout,
  updateMe as apiUpdateMe,
  setAuthToken,
  clearAuthToken,
} from '../api/client.js';

const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState(null);

  const refresh = useCallback(async () => {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const { ok, status, data } = await getMe();
      if (ok) {
        setAuthenticated(true);
        setUser(data?.user || null);
        setLoading(false);
        return true;
      }
      if (status === 401) {
        clearAuthToken();
        setAuthenticated(false);
        setUser(null);
        setLoading(false);
        return false;
      }
      if (attempt < maxAttempts && (status === 0 || status >= 500)) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
        continue;
      }
      break;
    }
    setLoading(false);
    return false;
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (email, password) => {
    const { ok, data } = await apiLogin(email, password);
    if (ok) {
      if (data?.token) setAuthToken(data.token);
      setAuthenticated(true);
      setUser(data?.user || null);
    }
    return ok;
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    clearAuthToken();
    setAuthenticated(false);
    setUser(null);
  }, []);

  const updateProfile = useCallback(async (patch) => {
    const { ok, data } = await apiUpdateMe(patch);
    if (ok) {
      if (data?.token) setAuthToken(data.token);
      if (data?.user) setUser(data.user);
    }
    return { ok, data };
  }, []);

  const value = useMemo(() => ({
    loading, authenticated, user, login, logout, refresh, updateProfile,
  }), [loading, authenticated, user, login, logout, refresh, updateProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
