import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiFetch, setTokens, clearTokens, getAccessToken } from '../services/api';
import { olvidarCache } from '../utils/progress';
import { olvidarEstado } from '../services/estado';
import { connectProgressWs, disconnectProgressWs } from '../services/ws';
import { reafirmarAvisos } from '../services/push';

export interface Me { id: number; username: string; role: 'admin' | 'user'; quota_bytes: number | null; used_bytes: number }

interface Ctx {
  me: Me | null;
  loading: boolean;
  /** null mientras no se sabe; false manda al onboarding. */
  hasPrefs: boolean | null;
  login: (u: string, p: string) => Promise<string | null>;
  logout: () => void;
  refresh: () => Promise<void>;
  refreshPrefs: () => Promise<void>;
}

const AuthCtx = createContext<Ctx>({ me: null, loading: true, hasPrefs: null, login: async () => null, logout: () => {}, refresh: async () => {}, refreshPrefs: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasPrefs, setHasPrefs] = useState<boolean | null>(null);

  const refreshPrefs = async () => {
    try {
      const r = await apiFetch('/preferences');
      if (!r.ok) throw new Error();
      const d = await r.json();
      setHasPrefs(d.preferences !== null);
    } catch {
      // Si no se puede comprobar, no se fuerza el onboarding: es peor
      // encerrar a alguien ahi por un fallo de red que no personalizar.
      setHasPrefs(true);
    }
  };

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
    refresh().then(() => { connectProgressWs(); return refreshPrefs(); }).finally(() => setLoading(false));
  }, []);

  // Este teléfono, a nombre de la cuenta que acaba de entrar (ver reafirmarAvisos).
  useEffect(() => { if (me?.id) reafirmarAvisos('m'); }, [me?.id]);

  const login = async (u: string, p: string) => {
    try {
      const r = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) });
      const d = await r.json();
      if (!r.ok) return d.detail || 'No se pudo entrar';
      setTokens(d.access_token, d.refresh_token);
      // La fila "Continuar viendo" es de la cuenta, y su cache del navegador:
      // en un aparato compartido, entrar con otro usuario pintaba la fila del
      // anterior hasta que contestara el servidor (o para siempre sin red).
      olvidarCache();
      olvidarEstado();
      await refresh();
      await refreshPrefs();
      connectProgressWs();
      return null;
    } catch { return 'Sin conexión con el servidor'; }
  };

  const logout = () => { clearTokens(); olvidarCache(); olvidarEstado(); disconnectProgressWs(); setMe(null); setHasPrefs(null); };

  return <AuthCtx.Provider value={{ me, loading, hasPrefs, login, logout, refresh, refreshPrefs }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
