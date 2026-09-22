import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiFetch, setTokens, clearTokens, getAccessToken } from '../services/api';
import { connectProgressWs, disconnectProgressWs } from '../services/ws';

export interface Me { id: number; username: string; role: 'admin' | 'user'; quota_bytes: number | null; used_bytes: number }

interface Ctx {
  me: Me | null;
  loading: boolean;
  login: (u: string, p: string) => Promise<string | null>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthCtx = createContext<Ctx>({ me: null, loading: true, login: async () => null, logout: () => {}, refresh: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const r = await apiFetch('/auth/me');
      if (!r.ok) throw new Error();
      const d = await r.json();
      setMe({ id: d.id, username: d.username, role: d.role, quota_bytes: d.quota_bytes ?? null, used_bytes: d.used_bytes || 0 });
    } catch { setMe(null); }
  };

  useEffect(() => {
    if (!getAccessToken()) { setLoading(false); return; }
    refresh().then(() => { connectProgressWs(); }).finally(() => setLoading(false));
  }, []);

  const login = async (u: string, p: string) => {
    try {
      const r = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) });
      const d = await r.json();
      if (!r.ok) return d.detail || 'No se pudo entrar';
      setTokens(d.access_token, d.refresh_token);
      await refresh();
      connectProgressWs();
      return null;
    } catch { return 'Sin conexión con el servidor'; }
  };

  const logout = () => { clearTokens(); disconnectProgressWs(); setMe(null); };

  return <AuthCtx.Provider value={{ me, loading, login, logout, refresh }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
