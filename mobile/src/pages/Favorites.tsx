import { useEffect, useState } from 'react';
import Poster from '../components/Poster';
import { useFavorites } from '../contexts/FavoritesContext';
import { groupFavorites } from '../utils/favorites';

/**
 * Favoritos de la cuenta, clasificados por tipo y, dentro de cada tipo, por
 * genero.
 *
 * Peliculas y series van en un conmutador y no una debajo de otra: en el
 * telefono caben tres caratulas por fila, asi que con las dos listas apiladas
 * las series quedaban a varias pantallas de distancia. El conmutador solo
 * aparece si hay de los dos tipos; con uno solo seria un boton que no elige
 * nada.
 */
export default function Favorites() {
  const { items, loading, recargar } = useFavorites();
  const [tipo, setTipo] = useState<'movie' | 'series'>('movie');

  useEffect(() => { recargar(); }, [recargar]);

  const secciones = groupFavorites(items);
  // Al entrar sin peliculas marcadas, el conmutador no debe empezar vacio.
  const activa = secciones.find(s => s.kind === tipo) || secciones[0];

  return (
    <div className="pb-6">
      <div className="px-4 pb-4" style={{ paddingTop: 'calc(var(--safe-t) + 20px)' }}>
        <h1 className="text-[28px] font-bold">Favoritos</h1>
        <p className="text-[12px] text-nf-text2 mt-1">
          {loading && items.length === 0 ? 'Cargando…'
            : `${items.length} ${items.length === 1 ? 'título guardado' : 'títulos guardados'}`}
        </p>

        {secciones.length > 1 && (
          <div className="mt-3 flex rounded-full bg-white/10 p-0.5 text-[12px] w-max">
            {secciones.map(s => (
              <button key={s.kind} onClick={() => setTipo(s.kind)}
                className={`px-4 h-8 rounded-full ${s.kind === activa?.kind ? 'bg-white text-black' : 'text-nf-text2'}`}>
                {s.title} <span className="opacity-60">{s.total}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {activa?.groups.map(grupo => (
        <div key={grupo.genre} className="mb-5">
          <h2 className="px-4 mb-2 text-[15px] font-semibold">
            {grupo.genre}
            <span className="ml-2 text-[12px] font-normal text-nf-text3">{grupo.items.length}</span>
          </h2>
          <div className="grid grid-cols-3 gap-3 px-4">
            {grupo.items.map(i => (
              <Poster key={i.id} full to={`/t/${i.media_type}/${i.tmdb_id}`} title={i.title} poster={i.poster}
                subtitle={i.media_type === 'series' && i.episode_count ? `${i.episode_count} ep.` : i.year ? String(i.year) : undefined} />
            ))}
          </div>
        </div>
      ))}

      {!loading && items.length === 0 && (
        <div className="px-4 pt-6">
          <p className="text-[15px] text-nf-text2">Todavía no has marcado nada.</p>
          <p className="text-[13px] text-nf-text3 mt-1">Abre una película o una serie y toca el corazón.</p>
        </div>
      )}
    </div>
  );
}
