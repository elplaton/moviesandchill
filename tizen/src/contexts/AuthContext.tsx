import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { apiFetch, setTokens, clearTokens, getAccessToken } from '../services/api';
import { connectProgressWs, disconnectProgressWs } from '../services/ws';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  username: string | null;
  isAdmin: boolean;
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
      apiFetch('/auth/me')
        .then((res) => res.json())
        .then((d) => setIsAdmin(d.role === 'admin'));
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
    <AuthContext.Provider value={{ isAuthenticated, isLoading, username, isAdmin, hasPreferences, login, logout, refreshPreferences }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
