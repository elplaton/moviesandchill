import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { apiFetch, setTokens, clearTokens, getAccessToken } from '../services/api';
import { olvidarCache } from '../utils/progress';
import { olvidarEstado } from '../services/estado';
import { olvidarCarriles } from '../hooks/useCarriles';
import { connectProgressWs, disconnectProgressWs } from '../services/ws';
import { reafirmarAvisos } from '../services/push';

interface AuthContextType {
  /** Dentro y con la contraseña ya suya: lo que tienen que mirar las pantallas. */
  isAuthenticated: boolean;
  /** Dentro con la contraseña provisional que le dio el admin: hasta cambiarla
   *  el servidor no deja hacer nada más (ver CambiarPassword). */
  mustChangePassword: boolean;
  cambiarPassword: (nueva: string) => Promise<string | null>;
  isLoading: boolean;
  username: string | null;
  isAdmin: boolean;
  usedBytes: number;
  quotaBytes: number | null;
  refreshMe: () => Promise<void>;
  hasPreferences: boolean | null;
  login: (username: string, password: string, remember?: boolean) => Promise<string | null>;
  logout: () => void;
  refreshPreferences: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  mustChangePassword: false,
  cambiarPassword: async () => null,
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
  const [dentro, setDentro] = useState(false);
  const [mustChangePassword, setMustChange] = useState(false);
  // Favoritos, descargas y demás cargan al ver una sesión abierta: con la
  // contraseña provisional todo eso contestaría 403, así que no lo está.
  const isAuthenticated = dentro && !mustChangePassword;
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
            setDentro(true);
            setUsername(data.username);
            setIsAdmin(data.role === 'admin');
            setUsedBytes(data.used_bytes || 0);
            setQuotaBytes(data.quota_bytes ?? null);
            if (data.must_change_password) { setMustChange(true); return; }
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

  // Este navegador, a nombre de la cuenta que acaba de entrar (ver reafirmarAvisos).
  useEffect(() => { if (username) reafirmarAvisos('web'); }, [username]);

  const login = async (user: string, password: string, remember = true): Promise<string | null> => {
    try {
      const res = await fetch('/api/auth/login', {
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
      // Los carriles en memoria llevan "Mis favoritos" y lo que esta cuenta
      // ha pedido: son de la cuenta, no del navegador.
      olvidarCarriles();
      setDentro(true);
      setUsername(user);
      await refreshMe();
      if (data.must_change_password) { setMustChange(true); return null; }
      connectProgressWs();
      await checkPreferences();
      return null;
    } catch {
      return 'Error de conexión';
    }
  };

  const cambiarPassword = async (nueva: string): Promise<string | null> => {
    try {
      const res = await apiFetch('/auth/password', { method: 'POST', body: JSON.stringify({ new_password: nueva }) });
      const data = await res.json();
      if (!res.ok) return data.detail || 'No se ha podido cambiar';
      // Los tokens de antes solo valían para llegar aquí. Sin tercer argumento
      // se respeta el «Recuérdame» elegido al entrar.
      setTokens(data.access_token, data.refresh_token);
      setMustChange(false);
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
    olvidarCache();
    olvidarEstado();
    olvidarCarriles();
    disconnectProgressWs();
    setDentro(false);
    setMustChange(false);
    setUsername(null);
    setIsAdmin(false);
    setHasPreferences(null);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, mustChangePassword, cambiarPassword, isLoading, username, isAdmin, usedBytes, quotaBytes, refreshMe, hasPreferences, login, logout, refreshPreferences }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
