import { useEffect } from 'react';
import Shell from '../components/Shell';
import Card from '../components/Card';
import Button from '../components/ui/Button';
import TitleSheet from '../components/TitleSheet';
import { useSheet } from '../hooks/useCatalog';
import { useFavorites } from '../contexts/FavoritesContext';
import { IconHeart, IconInfo } from '../components/ui/Icon';

/**
 * Favoritos: lo que la cuenta ha marcado, lo último primero.
 *
 * Es una rejilla y no carriles porque aquí no hay géneros que separar: es una
 * sola lista, y en una rejilla se ve entera sin empujar flechas.
 */
export default function Favorites() {
  const { items, loading, recargar, alternar } = useFavorites();
  const { sheet, setSheet, open } = useSheet();

  // Las claves se cargan al entrar en la app, pero las fichas solo aquí.
  useEffect(() => { recargar(); }, [recargar]);

  return (
    <Shell>
      <div className="px-gutter">
        <div className="mb-8">
          <h1 className="text-page font-bold">Favoritos</h1>
          <p className="mt-1 text-base text-nf-dim">
            {loading && items.length === 0 ? 'Cargando…'
              : `${items.length} ${items.length === 1 ? 'título' : 'títulos'} guardados`}
          </p>
        </div>

        {items.length > 0 && (
          <div className="grid gap-x-[var(--row-gap)] gap-y-7 [grid-template-columns:repeat(auto-fill,minmax(var(--card-w),1fr))]">
            {items.map(item => (
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
        )}

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
