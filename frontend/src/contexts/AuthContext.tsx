import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { apiFetch, setTokens, clearTokens, getAccessToken } from '../services/api';
import { connectProgressWs, disconnectProgressWs } from '../services/ws';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  username: string | null;
  isAdmin: boolean;
  usedBytes: number;
  quotaBytes: number | null;
  refreshMe: () => Promise<void>;
  hasPreferences: boolean | null;
  login: (username: string, password: string) => Promise<string | null>;
  logout: () => void;
  refreshPreferences: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  isLoading: true,
  username: null,
  isAdmin: false,
  usedBytes: 0,
  quotaBytes: null,
  refreshMe: async () => {},
  hasPreferences: null,
  login: async () => null,
  logout: () => {},
  refreshPreferences: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [username, setUsername] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [usedBytes, setUsedBytes] = useState(0);
  const [quotaBytes, setQuotaBytes] = useState<number | null>(null);

  const refreshMe = async () => {
    try {
      const d = await (await apiFetch('/auth/me')).json();
      setIsAdmin(d.role === 'admin');
      setUsedBytes(d.used_bytes || 0);
      setQuotaBytes(d.quota_bytes ?? null);
    } catch {}
  };
  const [hasPreferences, setHasPreferences] = useState<boolean | null>(null);

  const checkPreferences = async () => {
    try {
      const res = await apiFetch('/preferences');
      const data = await res.json();
      setHasPreferences(data.preferences !== null);
    } catch { setHasPreferences(false); }
  };

  useEffect(() => {
    const token = getAccessToken();
    if (token) {
      apiFetch('/auth/me')
        .then((res) => res.json())
        .then((data) => {
          if (data.username) {
            setIsAuthenticated(true);
            setUsername(data.username);
            setIsAdmin(data.role === 'admin');
            setUsedBytes(data.used_bytes || 0);
            setQuotaBytes(data.quota_bytes ?? null);
            connectProgressWs();
            checkPreferences();
          } else {
            clearTokens();
          }
        })
        .catch(() => clearTokens())
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const login = async (user: string, password: string): Promise<string | null> => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password }),
      });
      const data = await res.json();
      if (!res.ok) return data.detail || 'Error de login';
      setTokens(data.access_token, data.refresh_token);
      setIsAuthenticated(true);
      setUsername(user);
      await refreshMe();
      connectProgressWs();
      await checkPreferences();
      return null;
    } catch {
      return 'Error de conexión';
    }
  };

  const refreshPreferences = async () => {
    await checkPreferences();
  };

  const logout = () => {
    clearTokens();
    disconnectProgressWs();
    setIsAuthenticated(false);
    setUsername(null);
    setIsAdmin(false);
    setHasPreferences(null);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, username, isAdmin, usedBytes, quotaBytes, refreshMe, hasPreferences, login, logout, refreshPreferences }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
