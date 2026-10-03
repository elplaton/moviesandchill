import { useCallback, useEffect, useState } from 'react';
import { fetchMediaFiles } from '../services/media';
import { useFavorites } from '../contexts/FavoritesContext';
import { groupFavorites } from '../utils/favorites';
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
 * Favoritos: lo que la cuenta ha marcado, en un carril por tipo y genero
 * ("Peliculas · Accion", "Series · Comedia").
 *
 * Se separan porque en una tele un carril de 60 caratulas se recorre a ciegas:
 * con el mando solo se ve lo que cabe en pantalla y hay que mantener la flecha
 * pulsada para llegar al final. El tipo va en el titulo del carril en vez de
 * en una cabecera aparte porque aqui el foco baja de fila en fila y no hay
 * donde enfocar un encabezado.
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

  const carriles = groupFavorites(items).flatMap((seccion) =>
    seccion.groups.map((grupo) => ({
      titulo: `${seccion.title} · ${grupo.genre}`,
      lista: grupo.items,
    })),
  );

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
