import { useCallback, useEffect, useState } from 'react';
import { fetchMediaFiles } from '../services/media';
import { useFavorites } from '../contexts/FavoritesContext';
import Screen from '../components/Screen';
import Row from '../components/Row';
import PosterCard from '../components/PosterCard';
import TitleDetail, { type DetailInput } from '../components/TitleDetail';
import type { BrowseItem, Featured } from '../types';

function toFeatured(item: BrowseItem): Featured {
  return {
    key: `fav-${item.id}`,
    title: item.title,
    kind: item.media_type,
    poster: item.poster,
    backdrop: item.backdrop,
    year: item.year,
    rating: item.rating,
    overview: item.overview,
    genres: item.genres,
    subtitle: item.media_type === 'series' && item.episode_count ? `${item.episode_count} episodios` : undefined,
  };
}

/**
 * Favoritos: lo que la cuenta ha marcado, en dos carriles (peliculas y
 * series). Se separan porque en una tele un carril de 60 caratulas se
 * recorre a ciegas, y porque es como estan el resto de pantallas.
 */
export default function Favorites() {
  const { items, loading, recargar } = useFavorites();
  const [detail, setDetail] = useState<DetailInput | null>(null);

  useEffect(() => { recargar(); }, [recargar]);

  const abrir = useCallback(async (item: BrowseItem, f: Featured) => {
    try {
      const { results } = await fetchMediaFiles(item.tmdb_id, item.media_type);
      setDetail({ kind: item.media_type, tmdbId: item.tmdb_id, meta: f, files: results });
    } catch {
      setDetail({ kind: item.media_type, tmdbId: item.tmdb_id, meta: f, files: [] });
    }
  }, []);

  const peliculas = items.filter((i) => i.media_type === 'movie');
  const series = items.filter((i) => i.media_type === 'series');
  const carriles = [
    { titulo: 'Películas', lista: peliculas },
    { titulo: 'Series', lista: series },
  ].filter((c) => c.lista.length > 0);

  return (
    <Screen hero heading="Favoritos" heroFallback={items[0] ? toFeatured(items[0]) : null} ready={items.length > 0}>
      {carriles.map((c, ri) => (
        <Row key={c.titulo} index={ri} title={c.titulo}>
          {c.lista.map((item, i) => {
            const f = toFeatured(item);
            return <PosterCard key={f.key} index={i} item={f} autoFocus={ri === 0 && i === 0} onSelect={() => abrir(item, f)} />;
          })}
        </Row>
      ))}

      {loading && items.length === 0 && (
        <p className="text-body text-tv-text3" style={{ paddingLeft: 'var(--content-x)' }}>Cargando favoritos…</p>
      )}
      {!loading && items.length === 0 && (
        <div style={{ paddingLeft: 'var(--content-x)' }}>
          <p className="text-lead text-tv-text2">Todavía no has marcado nada.</p>
          <p className="text-body text-tv-text3 mt-2">Abre una película o una serie y pulsa Favorito.</p>
        </div>
      )}

      {detail && <TitleDetail input={detail} onClose={() => setDetail(null)} />}
    </Screen>
  );
}
