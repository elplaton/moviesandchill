import { useMemo } from 'react';
import Shell from '../components/Shell';
import Rail from '../components/Rail';
import Card from '../components/Card';
import Hero from '../components/Hero';
import TitleSheet from '../components/TitleSheet';
import Button from '../components/ui/Button';
import { useCatalog } from '../hooks/useCatalog';
import { IconInfo, IconPlay } from '../components/ui/Icon';
import type { BrowseItem } from '../types';

interface Props {
  /** Sin filtro es la portada (con destacado); con filtro, Películas o Series. */
  filter?: 'movie' | 'series';
  heading?: string;
}

/** Portada, Películas y Series: los tres son carriles sobre el mismo catálogo. */
export default function Catalog({ filter, heading }: Props) {
  const { rows, loading, sheet, setSheet, open } = useCatalog(filter);

  // El destacado sale de Novedades, que es lo más reciente y con mejor imagen.
  const hero = useMemo(() => {
    if (filter) return null;
    const pool = rows.find(r => r.genre === 'Novedades')?.items || rows[0]?.items || [];
    return pool.find(i => i.backdrop) || pool[0] || null;
  }, [rows, filter]);

  const card = (item: BrowseItem, rowKey: string) => (
    <Card
      key={`${rowKey}-${item.id}`}
      title={item.title}
      poster={item.poster}
      rating={item.rating}
      meta={item.media_type === 'series' && item.episode_count
        ? `${item.episode_count} episodios`
        : item.year ? String(item.year) : undefined}
      onOpen={() => open(item)}
      actions={
        <Button variant="light" size="sm" icon={<IconInfo />} onClick={() => open(item)}>
          {item.media_type === 'series' ? 'Ver episodios' : 'Ver detalles'}
        </Button>
      }
    />
  );

  return (
    <Shell flush={!!hero}>
      {hero && <Hero item={hero} onOpen={() => open(hero)} />}

      {!hero && heading && (
        <div className="mb-6 px-gutter">
          <h1 className="text-page font-bold">{heading}</h1>
        </div>
      )}

      {rows.map(row => (
        <Rail key={row.genre} title={row.genre}>
          {row.items.map(item => card(item, row.genre))}
        </Rail>
      ))}

      {loading && <p className="px-gutter py-10 text-base text-nf-faint">Cargando catálogo…</p>}
      {!loading && rows.length === 0 && (
        <div className="px-gutter py-16">
          <p className="text-lg text-nf-dim">Todavía no hay nada indexado.</p>
          <p className="mt-1 text-base text-nf-faint">Añade canales desde Administración y espera a que termine el escaneo.</p>
        </div>
      )}

      <div className="h-16" />
      {sheet && <TitleSheet input={sheet} onClose={() => setSheet(null)} />}
    </Shell>
  );
}
