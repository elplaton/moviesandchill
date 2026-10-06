import { useCallback, useEffect, useMemo, useState } from 'react';
import Shell from '../components/Shell';
import Rail from '../components/Rail';
import Card from '../components/Card';
import ContinueCard from '../components/ContinueCard';
import Hero from '../components/Hero';
import Player from '../components/Player';
import TitleSheet from '../components/TitleSheet';
import Button from '../components/ui/Button';
import { useCatalog } from '../hooks/useCatalog';
import { cachedContinueWatching, clearWatched, continueWatching, type Watched } from '../utils/progress';
import { IconInfo, IconPlay } from '../components/ui/Icon';
import type { BrowseItem } from '../types';

interface Props {
  /** Sin filtro es la portada (con destacado); con filtro, Películas o Series. */
  filter?: 'movie' | 'series';
  heading?: string;
}

/** Portada, Películas y Series: los tres son carriles sobre el mismo catálogo. */
export default function Catalog({ filter, heading }: Props) {
  const { rows, loading, cargarMas, scrollXDe, recordarScrollX,
          sheet, open, cerrar } = useCatalog(filter);
  // "Continuar viendo" solo en la portada: en Películas y Series estorbaría.
  // De la caché primero para que esté ahí sin esperar a la red, y acto seguido
  // lo que diga el servidor, que es quien sabe lo visto en el móvil o la tele.
  const [resume, setResume] = useState<Watched[]>(() => (filter ? [] : cachedContinueWatching()));
  const [playing, setPlaying] = useState<Watched | null>(null);

  const refrescar = useCallback(() => {
    if (filter) return;
    continueWatching().then(setResume).catch(() => {});
  }, [filter]);

  useEffect(() => { refrescar(); }, [refrescar]);

  const quitar = useCallback((w: Watched) => {
    // Se quita a la vista antes de que conteste el servidor, y si falla la
    // próxima lectura lo devuelve. Es lo mismo que hace el corazón de
    // favoritos: una lista que tarda en reaccionar parece rota.
    setResume(prev => prev.filter(x => x.path !== w.path));
    clearWatched(w.path).catch(() => {});
  }, []);

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

      {resume.length > 0 && (
        <Rail title="Continuar viendo">
          {resume.map(w => (
            <ContinueCard key={w.path} item={w}
              onPlay={() => setPlaying(w)} onRemove={() => quitar(w)} />
          ))}
        </Rail>
      )}

      {/* Las filas de género se piden de veinte en veinte al acercarse al final
          del carril, y sueltan las tarjetas de la izquierda para no acumular
          mil nodos; `shift` es lo que deja el scroll donde estaba. */}
      {rows.map(row => (
        <Rail key={row.genre} title={row.genre}
          onNearEnd={row.key ? () => cargarMas(row.genre, 1) : undefined}
          onNearStart={row.key ? () => cargarMas(row.genre, -1) : undefined}
          shift={row.shift}
          scrollX={scrollXDe(row.genre)}
          onScrollX={x => recordarScrollX(row.genre, x)}>
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
      {sheet && <TitleSheet input={sheet} onClose={cerrar} />}
      {playing && (
        <Player path={playing.path} title={playing.title} subtitle={playing.subtitle}
          poster={playing.poster} backdrop={playing.backdrop}
          tmdbId={playing.tmdb_id ?? undefined} mediaType={playing.media_type}
          onClose={() => { setPlaying(null); refrescar(); }} />
      )}
    </Shell>
  );
}
