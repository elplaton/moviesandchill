import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiFetch } from '../services/api';
import { useAuth } from './AuthContext';
import type { BrowseItem } from '../types';

interface Ctx {
  keys: Set<number>;
  items: BrowseItem[];
  loading: boolean;
  sigue: (tmdbId: number) => boolean;
  alternar: (tmdbId: number) => Promise<void>;
  recargar: () => Promise<void>;
}

const FollowCtx = createContext<Ctx | null>(null);

/**
 * Series que sigue la cuenta, para avisar de los episodios nuevos.
 *
 * Igual que favoritos: al entrar solo se piden los ids (lo justo para pintar
 * la campana de la ficha) y la lista entera cuando alguien la mira. Solo hay
 * ids porque el seguimiento es de series y nada más: una película no estrena
 * episodios.
 *
 * Es el mismo archivo en `frontend/` y en `mobile/`.
 */
export function FollowsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [keys, setKeys] = useState<Set<number>>(new Set());
  const [items, setItems] = useState<BrowseItem[]>([]);
  const [loading, setLoading] = useState(false);

  const recargar = useCallback(async () => {
    setLoading(true);
    try {
      const d = await (await apiFetch('/follows')).json();
      setItems(d.items || []);
      setKeys(new Set<number>(d.keys || []));
    } catch { /* sin conexión */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) { setKeys(new Set()); setItems([]); return; }
    apiFetch('/follows?keys_only=true')
      .then(r => r.json())
      .then(d => setKeys(new Set<number>(d.keys || [])))
      .catch(() => {});
  }, [isAuthenticated]);

  const sigue = useCallback((tmdbId: number) => keys.has(tmdbId), [keys]);

  const alternar = useCallback(async (tmdbId: number) => {
    const seguia = keys.has(tmdbId);
    // Se pinta al tocarlo y se deshace si el servidor dice que no: un botón
    // que tarda en reaccionar parece roto.
    setKeys(prev => { const n = new Set(prev); seguia ? n.delete(tmdbId) : n.add(tmdbId); return n; });
    if (seguia) setItems(prev => prev.filter(i => i.tmdb_id !== tmdbId));
    try {
      const res = await apiFetch('/follows', {
        method: seguia ? 'DELETE' : 'POST',
        body: JSON.stringify({ tmdb_id: tmdbId }),
      });
      if (!res.ok) throw new Error();
      if (!seguia && items.length) recargar();
    } catch {
      setKeys(prev => { const n = new Set(prev); seguia ? n.add(tmdbId) : n.delete(tmdbId); return n; });
    }
  }, [keys, items.length, recargar]);

  return (
    <FollowCtx.Provider value={{ keys, items, loading, sigue, alternar, recargar }}>
      {children}
    </FollowCtx.Provider>
  );
}

export function useFollows(): Ctx {
  const v = useContext(FollowCtx);
  if (!v) throw new Error('FollowsProvider ausente');
  return v;
}
