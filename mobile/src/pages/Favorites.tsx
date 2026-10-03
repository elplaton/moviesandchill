import { useEffect } from 'react';
import Poster from '../components/Poster';
import { useFavorites } from '../contexts/FavoritesContext';

/** Favoritos de la cuenta, lo último marcado primero. */
export default function Favorites() {
  const { items, loading, recargar } = useFavorites();

  useEffect(() => { recargar(); }, [recargar]);

  return (
    <div className="pb-6">
      <div className="px-4 pb-4" style={{ paddingTop: 'calc(var(--safe-t) + 20px)' }}>
        <h1 className="text-[28px] font-bold">Favoritos</h1>
        <p className="text-[12px] text-nf-text2 mt-1">
          {loading && items.length === 0 ? 'Cargando…'
            : `${items.length} ${items.length === 1 ? 'título' : 'títulos'} guardados`}
        </p>
      </div>

      {items.length > 0 && (
        <div className="grid grid-cols-3 gap-3 px-4">
          {items.map(i => (
            <Poster key={i.id} full to={`/t/${i.media_type}/${i.tmdb_id}`} title={i.title} poster={i.poster}
              subtitle={i.media_type === 'series' && i.episode_count ? `${i.episode_count} ep.` : i.year ? String(i.year) : undefined} />
          ))}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="px-4 pt-6">
          <p className="text-[15px] text-nf-text2">Todavía no has marcado nada.</p>
          <p className="text-[13px] text-nf-text3 mt-1">Abre una película o una serie y toca el corazón.</p>
        </div>
      )}
    </div>
  );
}
