import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { apiFetch, setTokens, clearTokens, getAccessToken } from '../services/api';
import { olvidarCache } from '../tv/progress';
import { olvidarEstado } from '../services/estado';
import { connectProgressWs, disconnectProgressWs } from '../services/ws';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  username: string | null;
  isAdmin: boolean;
  /** null mientras no se sabe; false manda al onboarding. */
  hasPrefs: boolean | null;
  login: (username: string, password: string, remember?: boolean) => Promise<string | null>;
  logout: () => void;
  refreshPrefs: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  isLoading: true,
  username: null,
  isAdmin: false,
  hasPrefs: null,
  login: async () => null,
  logout: () => {},
  refreshPrefs: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [username, setUsername] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [hasPrefs, setHasPrefs] = useState<boolean | null>(null);

  const refreshPrefs = async () => {
    try {
      const r = await apiFetch('/preferences');
      if (!r.ok) throw new Error();
      const d = await r.json();
      setHasPrefs(d.preferences !== null);
    } catch {
      // Ante la duda no se fuerza el onboarding: es peor dejar a alguien
      // encerrado ahi por un fallo de red que no personalizar la portada.
      setHasPrefs(true);
    }
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
            return refreshPrefs();
          }
          clearTokens();
        })
        .catch(() => clearTokens())
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const login = async (user: string, password: string, remember = true): Promise<string | null> => {
    try {
      const res = await apiFetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password }),
      });
      const data = await res.json();
      if (!res.ok) return data.detail || 'Error de login';
      setTokens(data.access_token, data.refresh_token, remember);
      // La fila "Continuar viendo" es de la cuenta, y su cache del navegador:
      // en un aparato compartido, entrar con otro usuario pintaba la fila del
      // anterior hasta que contestara el servidor (o para siempre sin red).
      olvidarCache();
      olvidarEstado();
      setIsAuthenticated(true);
      setUsername(user);
      apiFetch('/auth/me')
        .then((res) => res.json())
        .then((d) => setIsAdmin(d.role === 'admin'));
      await refreshPrefs();
      connectProgressWs();
      return null;
    } catch {
      return 'Error de conexión';
    }
  };

  const logout = () => {
    clearTokens();
    olvidarCache();
    olvidarEstado();
    disconnectProgressWs();
    setIsAuthenticated(false);
    setUsername(null);
    setIsAdmin(false);
    setHasPrefs(null);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, username, isAdmin, hasPrefs, login, logout, refreshPrefs }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
