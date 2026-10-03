import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiFetch } from '../services/api';
import { useAuth } from './AuthContext';
import type { BrowseItem } from '../types';

type Kind = 'movie' | 'series';
const clave = (tmdbId: number, kind: Kind) => `${kind === 'series' ? 's' : 'm'}${tmdbId}`;

interface Ctx {
  keys: Set<string>;
  items: BrowseItem[];
  loading: boolean;
  esFavorito: (tmdbId: number, kind: Kind) => boolean;
  alternar: (tmdbId: number, kind: Kind) => Promise<void>;
  recargar: () => Promise<void>;
}

const FavCtx = createContext<Ctx | null>(null);

/**
 * Favoritos de la cuenta. Igual que en la web: al entrar solo se piden las
 * claves (lo justo para pintar el corazon) y la lista con fichas cuando se
 * abre la pantalla. El corazon cambia al tocarlo y se deshace si el servidor
 * dice que no: en el movil la red falla mas y esperar se nota.
 */
export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const [items, setItems] = useState<BrowseItem[]>([]);
  const [loading, setLoading] = useState(false);

  const recargar = useCallback(async () => {
    setLoading(true);
    try {
      const d = await (await apiFetch('/favorites')).json();
      setItems(d.items || []);
      setKeys(new Set((d.keys || []).map((k: any) => clave(k.tmdb_id, k.media_type))));
    } catch { /* sin conexion */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!me) { setKeys(new Set()); setItems([]); return; }
    apiFetch('/favorites?keys_only=true')
      .then(r => r.json())
      .then(d => setKeys(new Set((d.keys || []).map((k: any) => clave(k.tmdb_id, k.media_type)))))
      .catch(() => {});
  }, [me]);

  const esFavorito = useCallback((id: number, kind: Kind) => keys.has(clave(id, kind)), [keys]);

  const alternar = useCallback(async (id: number, kind: Kind) => {
    const k = clave(id, kind);
    const estaba = keys.has(k);
    setKeys(prev => { const n = new Set(prev); estaba ? n.delete(k) : n.add(k); return n; });
    if (estaba) setItems(prev => prev.filter(i => i.id !== k));
    try {
      const res = await apiFetch('/favorites', {
        method: estaba ? 'DELETE' : 'POST',
        body: JSON.stringify({ tmdb_id: id, media_type: kind }),
      });
      if (!res.ok) throw new Error();
      if (!estaba) recargar();
    } catch {
      setKeys(prev => { const n = new Set(prev); estaba ? n.add(k) : n.delete(k); return n; });
    }
  }, [keys, recargar]);

  return <FavCtx.Provider value={{ keys, items, loading, esFavorito, alternar, recargar }}>{children}</FavCtx.Provider>;
}

export function useFavorites(): Ctx {
  const v = useContext(FavCtx);
  if (!v) throw new Error('FavoritesProvider ausente');
  return v;
}
