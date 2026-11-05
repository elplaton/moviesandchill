import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { apiFetch, setTokens, clearTokens, getAccessToken } from '../services/api';
import { olvidarCache } from '../tv/progress';
import { olvidarEstado } from '../services/estado';
import { connectProgressWs, disconnectProgressWs } from '../services/ws';

interface AuthContextType {
  /** Dentro y con la contraseña ya suya. */
  isAuthenticated: boolean;
  /** Dentro con la contraseña provisional que le dio el admin: hasta cambiarla
   *  el servidor no deja hacer nada más (ver pages/CambiarPassword). */
  mustChangePassword: boolean;
  cambiarPassword: (nueva: string) => Promise<string | null>;
  isLoading: boolean;
  username: string | null;
  isAdmin: boolean;
  /** null mientras no se sabe; false manda al onboarding. */
  hasPrefs: boolean | null;
  login: (username: string, password: string, remember?: boolean) => Promise<string | null>;
  /** Entrar con tokens ya emitidos: es lo que hace la entrada por QR. */
  entrarConTokens: (access: string, refresh: string, username: string, remember?: boolean) => Promise<void>;
  logout: () => void;
  refreshPrefs: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  mustChangePassword: false,
  cambiarPassword: async () => null,
  isLoading: true,
  username: null,
  isAdmin: false,
  hasPrefs: null,
  login: async () => null,
  entrarConTokens: async () => {},
  logout: () => {},
  refreshPrefs: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [dentro, setDentro] = useState(false);
  const [mustChangePassword, setMustChange] = useState(false);
  const isAuthenticated = dentro && !mustChangePassword;
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
            setDentro(true);
            setUsername(data.username);
            setIsAdmin(data.role === 'admin');
            if (data.must_change_password) { setMustChange(true); return; }
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
      await entrarConTokens(data.access_token, data.refresh_token, user, remember);
      return null;
    } catch {
      return 'Error de conexión';
    }
  };

  const entrarConTokens = async (access: string, refresh: string, user: string, remember = true) => {
    setTokens(access, refresh, remember);
    // La fila "Continuar viendo" es de la cuenta, y su cache del navegador:
    // en un aparato compartido, entrar con otro usuario pintaba la fila del
    // anterior hasta que contestara el servidor (o para siempre sin red).
    olvidarCache();
    olvidarEstado();
    setUsername(user);
    // Se espera a /me: dice si la contraseña es provisional, y entonces no se
    // pide nada más (el servidor contestaría 403 a todo).
    let cambiar = false;
    try {
      const d = await (await apiFetch('/auth/me')).json();
      setIsAdmin(d.role === 'admin');
      cambiar = !!d.must_change_password;
    } catch { /* sin /me se entra igual, como antes */ }
    setMustChange(cambiar);
    setDentro(true);
    if (cambiar) return;
    await refreshPrefs();
    connectProgressWs();
  };

  const cambiarPassword = async (nueva: string): Promise<string | null> => {
    try {
      const res = await apiFetch('/auth/password', { method: 'POST', body: JSON.stringify({ new_password: nueva }) });
      const data = await res.json();
      if (!res.ok) return data.detail || 'No se ha podido cambiar';
      // Los tokens de antes solo valían para llegar aquí. Sin tercer argumento
      // se respeta el «Recuérdame» elegido al entrar.
      setTokens(data.access_token, data.refresh_token);
      await refreshPrefs();
      setMustChange(false);
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
    setDentro(false);
    setMustChange(false);
    setUsername(null);
    setIsAdmin(false);
    setHasPrefs(null);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, mustChangePassword, cambiarPassword, isLoading, username, isAdmin, hasPrefs, login, entrarConTokens, logout, refreshPrefs }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
