import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiFetch, setTokens, clearTokens, getAccessToken } from '../services/api';
import { olvidarCache } from '../utils/progress';
import { olvidarEstado } from '../services/estado';
import { olvidarCarriles } from '../hooks/useCarriles';
import { connectProgressWs, disconnectProgressWs } from '../services/ws';
import { reafirmarAvisos } from '../services/push';

export interface Me { id: number; username: string; role: 'admin' | 'user'; quota_bytes: number | null; used_bytes: number }

interface Ctx {
  /** La cuenta, solo con la contraseña ya suya: favoritos, descargas y demás
   *  cargan al verla, y con la provisional el servidor les contestaría 403. */
  me: Me | null;
  /** Quien ha entrado con la contraseña provisional que le dio el admin y
   *  tiene que cambiarla antes de nada (ver CambiarPassword). */
  pendiente: string | null;
  cambiarPassword: (nueva: string) => Promise<string | null>;
  loading: boolean;
  /** null mientras no se sabe; false manda al onboarding. */
  hasPrefs: boolean | null;
  login: (u: string, p: string) => Promise<string | null>;
  logout: () => void;
  refresh: () => Promise<boolean>;
  refreshPrefs: () => Promise<void>;
}

const AuthCtx = createContext<Ctx>({ me: null, pendiente: null, cambiarPassword: async () => null, loading: true, hasPrefs: null, login: async () => null, logout: () => {}, refresh: async () => false, refreshPrefs: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [pendiente, setPendiente] = useState<string | null>(null);
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

  /** true si la cuenta está lista para usarse (dentro y sin contraseña provisional). */
  const refresh = async (): Promise<boolean> => {
    try {
      const r = await apiFetch('/auth/me');
      if (!r.ok) throw new Error();
      const d = await r.json();
      if (d.must_change_password) { setPendiente(d.username); setMe(null); return false; }
      setPendiente(null);
      setMe({ id: d.id, username: d.username, role: d.role, quota_bytes: d.quota_bytes ?? null, used_bytes: d.used_bytes || 0 });
      return true;
    } catch { setMe(null); return false; }
  };

  useEffect(() => {
    if (!getAccessToken()) { setLoading(false); return; }
    refresh().then((listo) => { if (!listo) return; connectProgressWs(); return refreshPrefs(); }).finally(() => setLoading(false));
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
      // Los carriles en memoria llevan "Mis favoritos" y lo que esta cuenta
      // ha pedido: son de la cuenta, no del aparato.
      olvidarCarriles();
      if (!await refresh()) return null;
      await refreshPrefs();
      connectProgressWs();
      return null;
    } catch { return 'Sin conexión con el servidor'; }
  };

  const cambiarPassword = async (nueva: string) => {
    try {
      const r = await apiFetch('/auth/password', { method: 'POST', body: JSON.stringify({ new_password: nueva }) });
      const d = await r.json();
      if (!r.ok) return d.detail || 'No se ha podido cambiar';
      // Los tokens de antes solo valían para llegar aquí.
      setTokens(d.access_token, d.refresh_token);
      if (!await refresh()) return 'No se ha podido comprobar la cuenta';
      await refreshPrefs();
      connectProgressWs();
      return null;
    } catch { return 'Sin conexión con el servidor'; }
  };

  const logout = () => { clearTokens(); olvidarCache(); olvidarEstado(); olvidarCarriles(); disconnectProgressWs(); setMe(null); setPendiente(null); setHasPrefs(null); };

  return <AuthCtx.Provider value={{ me, pendiente, cambiarPassword, loading, hasPrefs, login, logout, refresh, refreshPrefs }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
