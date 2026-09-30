const API_BASE = '/api';

const ACCESS = 'access_token';
const REFRESH = 'refresh_token';

/** Los dos almacenes, tolerando que el navegador los tenga capados. */
function leer(key: string): string | null {
  try {
    return sessionStorage.getItem(key) ?? localStorage.getItem(key);
  } catch {
    return null;
  }
}

let accessToken: string | null = leer(ACCESS);
let refreshToken: string | null = leer(REFRESH);

// Con «recuérdame» la sesión vive en localStorage y aguanta cerrar el
// navegador; sin él va a sessionStorage y se pierde al cerrar la pestaña.
// De dónde salieron los tokens al arrancar es lo que dice cuál se eligió,
// así que la decisión sobrevive a recargar la página.
let recordar = (() => {
  try {
    return sessionStorage.getItem(ACCESS) === null;
  } catch {
    return true;
  }
})();

export function setTokens(access: string, refresh: string, remember?: boolean) {
  // Al renovar el token no se vuelve a decidir: se respeta lo elegido al entrar.
  if (remember !== undefined) recordar = remember;
  accessToken = access;
  refreshToken = refresh;
  try {
    const destino = recordar ? localStorage : sessionStorage;
    const otro = recordar ? sessionStorage : localStorage;
    otro.removeItem(ACCESS);
    otro.removeItem(REFRESH);
    destino.setItem(ACCESS, access);
    destino.setItem(REFRESH, refresh);
  } catch { /* modo privado: la sesión dura lo que dure la pestaña */ }
}

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
  try {
    localStorage.removeItem(ACCESS);
    localStorage.removeItem(REFRESH);
    sessionStorage.removeItem(ACCESS);
    sessionStorage.removeItem(REFRESH);
  } catch { /* nada que limpiar */ }
}

export function getAccessToken() {
  return accessToken;
}

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    setTokens(data.access_token, data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };
  if (!headers['Content-Type'] && options.body) {
    headers['Content-Type'] = 'application/json';
  }
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401 && refreshToken) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${accessToken}`;
      res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    }
  }

  if (res.status === 401) {
    // Sin token no hay sesion que caducar, y en /login no hay a donde ir:
    // redirigir ahi provocaba un bucle de recargas.
    const hadToken = !!accessToken;
    clearTokens();
    if (hadToken && window.location.pathname !== '/login') window.location.href = '/login';
  }

  return res;
}
