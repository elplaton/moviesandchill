import { useEffect } from 'react';
import Shell from '../components/Shell';
import Card from '../components/Card';
import Button from '../components/ui/Button';
import TitleSheet from '../components/TitleSheet';
import { useSheet } from '../hooks/useCatalog';
import { useFavorites } from '../contexts/FavoritesContext';
import { groupFavorites } from '../utils/favorites';
import { IconHeart, IconInfo } from '../components/ui/Icon';

/**
 * Favoritos: lo que la cuenta ha marcado, en dos secciones (Películas y
 * Series) y, dentro de cada una, un grupo por género.
 *
 * Siguen siendo rejillas y no carriles: en escritorio no hay swipe, y una
 * rejilla por género se ve entera sin empujar flechas. Las dos secciones van
 * una debajo de otra en vez de en pestañas porque aquí la pantalla es ancha y
 * así se abarca la lista completa de una pasada.
 */
export default function Favorites() {
  const { items, loading, recargar, alternar } = useFavorites();
  const { sheet, setSheet, open } = useSheet();

  // Las claves se cargan al entrar en la app, pero las fichas solo aquí.
  useEffect(() => { recargar(); }, [recargar]);

  const secciones = groupFavorites(items);

  return (
    <Shell>
      <div className="px-gutter">
        <div className="mb-8">
          <h1 className="text-page font-bold">Favoritos</h1>
          <p className="mt-1 text-base text-nf-dim">
            {loading && items.length === 0 ? 'Cargando…'
              : `${items.length} ${items.length === 1 ? 'título guardado' : 'títulos guardados'}`}
          </p>
        </div>

        {secciones.map(seccion => (
          <section key={seccion.kind} className="mb-12">
            <div className="flex items-baseline gap-3 border-b border-white/10 pb-2">
              <h2 className="text-title font-bold">{seccion.title}</h2>
              <span className="text-sm text-nf-faint">
                {seccion.total} {seccion.total === 1 ? 'título' : 'títulos'}
              </span>
            </div>

            {seccion.groups.map(grupo => (
              <div key={grupo.genre} className="mt-7">
                <h3 className="mb-3 text-md font-semibold text-nf-dim">
                  {grupo.genre}
                  <span className="ml-2 text-sm font-normal text-nf-faint">{grupo.items.length}</span>
                </h3>
                <div className="grid gap-x-[var(--row-gap)] gap-y-7 [grid-template-columns:repeat(auto-fill,minmax(var(--card-w),1fr))]">
                  {grupo.items.map(item => (
                    <Card key={item.id} title={item.title} poster={item.poster} rating={item.rating}
                      meta={item.media_type === 'series' && item.episode_count
                        ? `${item.episode_count} episodios`
                        : item.year ? String(item.year) : undefined}
                      onOpen={() => open(item)}
                      actions={
                        <>
                          <Button variant="light" size="sm" icon={<IconInfo />} onClick={() => open(item)}>
                            {item.media_type === 'series' ? 'Ver episodios' : 'Ver detalles'}
                          </Button>
                          <Button variant="ghost" size="sm" icon={<IconHeart filled />}
                            onClick={() => alternar(item.tmdb_id, item.media_type)}>Quitar</Button>
                        </>
                      } />
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))}

        {!loading && items.length === 0 && (
          <div className="py-16">
            <p className="text-lg text-nf-dim">Todavía no has marcado nada.</p>
            <p className="mt-1 text-base text-nf-faint">Abre una película o una serie y pulsa Favorito.</p>
          </div>
        )}
      </div>

      <div className="h-16" />
      {sheet && <TitleSheet input={sheet} onClose={() => setSheet(null)} />}
    </Shell>
  );
}
