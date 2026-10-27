import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Shell from '../components/Shell';
import Rail from '../components/Rail';
import Card from '../components/Card';
import TopRail from '../components/TopRail';
import ContinueCard from '../components/ContinueCard';
import Hero from '../components/Hero';
import Player from '../components/Player';
import TitleSheet from '../components/TitleSheet';
import Button from '../components/ui/Button';
import { useCatalog } from '../hooks/useCatalog';
import type { Fuente } from '../hooks/useCarriles';
import { cachedContinueWatching, clearWatched, continueWatching, type Watched } from '../utils/progress';
import { IconInfo, IconPlay } from '../components/ui/Icon';
import type { BrowseItem } from '../types';

interface Props {
  /** Sin filtro es la portada (con destacado); con filtro, Películas o Series. */
  filter?: 'movie' | 'series';
  heading?: string;
  /** Plataformas: una fila por Netflix, HBO Max... en vez de la portada. */
  fuente?: Fuente;
}

/** Portada, Películas, Series y Plataformas: todo son carriles sobre el
 *  mismo catálogo; lo único que cambia es de dónde salen las filas. */
export default function Catalog({ filter, heading, fuente = 'portada' }: Props) {
  const { rows, loading, cargarMas, scrollXDe, recordarScrollX,
          sheet, open, cerrar } = useCatalog(filter, fuente);
  // El destacado y "Continuar viendo" son cosa de la portada.
  const portada = !filter && fuente === 'portada';
  // "Continuar viendo" solo en la portada: en Películas y Series estorbaría.
  // De la caché primero para que esté ahí sin esperar a la red, y acto seguido
  // lo que diga el servidor, que es quien sabe lo visto en el móvil o la tele.
  const [resume, setResume] = useState<Watched[]>(() => (portada ? cachedContinueWatching() : []));
  const [playing, setPlaying] = useState<Watched | null>(null);

  const refrescar = useCallback(() => {
    if (!portada) return;
    continueWatching().then(setResume).catch(() => {});
  }, [portada]);

  useEffect(() => { refrescar(); }, [refrescar]);

  const quitar = useCallback((w: Watched) => {
    // Se quita a la vista antes de que conteste el servidor, y si falla la
    // próxima lectura lo devuelve. Es lo mismo que hace el corazón de
    // favoritos: una lista que tarda en reaccionar parece rota.
    setResume(prev => prev.filter(x => x.path !== w.path));
    clearWatched(w.path).catch(() => {});
  }, []);

  // El destacado sale de lo último que ha llegado a alguna plataforma (es de
  // lo que se habla), y si esa fila no está, de Novedades.
  const hero = useMemo(() => {
    if (!portada) return null;
    const pool = rows.find(r => r.key === 'plataforma:todas')?.items
      || rows.find(r => r.genre === 'Novedades')?.items || rows[0]?.items || [];
    // Un top trae también lo que no tenemos, y eso no tiene ficha que abrir.
    const nuestros = pool.filter(i => i.en_catalogo !== false);
    return nuestros.find(i => i.backdrop) || nuestros[0] || null;
  }, [rows, portada]);

  const card = (item: BrowseItem, rowKey: string) => (
    <Card
      key={`${rowKey}-${item.id}`}
      title={item.title}
      poster={item.poster}
      rating={item.rating}
      meta={item.subtitulo ? item.subtitulo
        : item.plataforma ? item.plataforma
        : item.media_type === 'series' && item.episode_count
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
      {rows.map((row, i) => {
        const titulo = row.titulo ?? row.genre;
        // En Plataformas las filas llegan agrupadas (todas las de Netflix,
        // luego las de HBO Max...): la cabecera va al empezar cada grupo.
        const seccion = row.seccion && row.seccion.clave !== rows[i - 1]?.seccion?.clave
          ? row.seccion : null;
        return (
          <Fragment key={row.genre}>
            {seccion && (
              <div className={`mb-4 flex items-center gap-3 px-gutter ${i > 0 ? 'mt-14' : ''}`}>
                {seccion.logo && (
                  <img src={seccion.logo} alt="" loading="lazy"
                    className="h-11 w-11 shrink-0 rounded-[10px] bg-nf-surface object-cover" />
                )}
                <h2 className="text-title font-bold">{seccion.nombre}</h2>
              </div>
            )}
            {row.top ? (
              <TopRail title={titulo} top={row.top} items={row.items} onOpen={open}
                scrollX={scrollXDe(row.genre)}
                onScrollX={x => recordarScrollX(row.genre, x)} />
            ) : (
              <Rail title={titulo}
                onNearEnd={row.key ? () => cargarMas(row.genre, 1) : undefined}
                onNearStart={row.key ? () => cargarMas(row.genre, -1) : undefined}
                shift={row.shift}
                scrollX={scrollXDe(row.genre)}
                onScrollX={x => recordarScrollX(row.genre, x)}>
                {row.items.map(item => card(item, row.genre))}
              </Rail>
            )}
          </Fragment>
        );
      })}

      {loading && <p className="px-gutter py-10 text-base text-nf-faint">Cargando catálogo…</p>}
      {!loading && rows.length === 0 && fuente === 'plataformas' && (
        <div className="px-gutter py-16">
          <p className="text-lg text-nf-dim">Todavía no hay nada que enseñar aquí.</p>
          <p className="mt-1 text-base text-nf-faint">El servidor está mirando en qué plataforma está cada título; vuelve en unos minutos.</p>
        </div>
      )}
      {!loading && rows.length === 0 && fuente === 'portada' && (
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
