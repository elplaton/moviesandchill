import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../services/api';
import { fetchMediaFiles } from '../services/media';
import type { BrowseItem, BrowseRow, TMDBMetadata } from '../types';
import type { SheetInput } from '../components/TitleSheet';

/**
 * Carriles de la portada y apertura de fichas.
 *
 * Lo tenían copiado Home, Películas y Series con pequeñas diferencias; aquí
 * está una sola vez, con el filtro por tipo como parámetro.
 */
export function useCatalog(filter?: 'movie' | 'series') {
  const [rows, setRows] = useState<BrowseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState<SheetInput | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiFetch('/browse/home')
      .then(r => r.json())
      .then(d => {
        if (!alive) return;
        let list: BrowseRow[] = d.rows || [];
        if (filter) {
          list = list
            .map(r => ({ ...r, items: r.items.filter(i => i.media_type === filter) }))
            .filter(r => r.items.length > 0);
        }
        setRows(list);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [filter]);

  const open = useCallback(async (item: BrowseItem) => {
    const meta: TMDBMetadata = {
      title: item.title, poster: item.poster, backdrop: item.backdrop,
      year: item.year, rating: item.rating, overview: item.overview, genres: item.genres,
    };
    try {
      const { results } = await fetchMediaFiles(item.tmdb_id, item.media_type);
      setSheet({ kind: item.media_type, tmdbId: item.tmdb_id, meta, files: results });
    } catch {
      setSheet({ kind: item.media_type, tmdbId: item.tmdb_id, meta, files: [] });
    }
  }, []);

  return { rows, loading, sheet, setSheet, open };
}
