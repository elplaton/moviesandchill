import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Poster from '../components/Poster';
import Row from '../components/Row';
import Player from '../components/Player';
import { cachedContinueWatching, continueWatching, importLocalProgress, type Watched } from '../utils/progress';
import { IPlay, IStar } from '../components/Icons';
import { useCarriles } from '../hooks/useCarriles';

/** Portada: un destacado grande, "Continuar viendo" y los carriles del servidor. */
export default function Home() {
  // Los carriles viven en un modulo, no en el componente: al volver de una
  // ficha estan las mismas filas, con las mismas caratulas ya cargadas y en
  // la misma posicion. Pedirlos otra vez devolveria un orden distinto.
  const { carriles: rows, loading, cargarMas, scrollXDe, recordarScrollX } = useCarriles();
  // De la cache primero, para que la fila este ahi al abrir la app, y acto
  // seguido lo que diga el servidor (que es quien manda y quien sabe lo visto
  // en la tele o en el escritorio).
  const [resume, setResume] = useState<Watched[]>(() => cachedContinueWatching());
  const [playing, setPlaying] = useState<Watched | null>(null);

  // Al volver a la pestaña se relee: el telefono suspende la app y lo que se
  // haya visto mientras tanto en otro aparato no llegaria solo.
  useEffect(() => {
    const refrescar = () => { continueWatching().then(setResume).catch(() => {}); };
    // Lo que este aparato tuviera guardado de antes se sube una sola vez.
    importLocalProgress().finally(refrescar);
    const alVolver = () => { if (!document.hidden) refrescar(); };
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('focus', refrescar);
    return () => {
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('focus', refrescar);
    };
  }, []);

  const hero = rows.find(r => r.genre === 'Novedades')?.items[0] || rows[0]?.items[0];
  const link = (i: { tmdb_id: number; media_type: string }) => `/t/${i.media_type}/${i.tmdb_id}`;

  return (
    <div className="pb-4">
      {hero && (
        <Link to={link(hero)} className="block relative h-[62vw] max-h-[420px] overflow-hidden">
          <img src={hero.backdrop || hero.poster} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(20,20,20,0.1) 30%, #141414 100%)' }} />
          <div className="absolute left-4 right-4 bottom-4">
            <p className="text-[11px] font-semibold text-nf-red tracking-wide mb-1">NOVEDAD</p>
            <h1 className="text-[26px] font-bold leading-tight line-clamp-2">{hero.title}</h1>
            <p className="text-[13px] text-nf-text2 mt-1 flex items-center gap-2">
              {hero.rating ? <span className="inline-flex items-center gap-1"><span className="w-3.5 h-3.5 text-nf-warn"><IStar /></span>{hero.rating.toFixed(1)}</span> : null}
              {hero.year && <span>· {hero.year}</span>}
              {hero.genres?.length ? <span>· {hero.genres.slice(0, 2).join(', ')}</span> : null}
            </p>
          </div>
        </Link>
      )}
      {!hero && <div className="px-4 pt-6 pb-4" style={{ paddingTop: 'calc(var(--safe-t) + 24px)' }}><h1 className="text-[28px] font-bold text-nf-red tracking-tighter">MOVIES&amp;CHILL</h1></div>}

      {resume.length > 0 && (
        <Row title="Continuar viendo">
          {resume.map(w => (
            <button key={w.path} onClick={() => setPlaying(w)} className="shrink-0 w-[160px] text-left active:opacity-70">
              <div className="relative rounded-lg overflow-hidden bg-nf-card aspect-video">
                {(w.backdrop || w.poster) && <img src={w.backdrop || w.poster} alt="" className="absolute inset-0 w-full h-full object-cover" />}
                <span className="absolute inset-0 flex items-center justify-center"><span className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center"><span className="w-5 h-5 ml-0.5"><IPlay /></span></span></span>
                {w.duration > 0 && <div className="absolute left-0 right-0 bottom-0 h-1 bg-white/25"><div className="h-full bg-nf-red" style={{ width: `${Math.round((w.position / w.duration) * 100)}%` }} /></div>}
              </div>
              <p className="mt-1.5 text-[12px] font-medium truncate">{w.title}</p>
              <p className="text-[11px] text-nf-text3 truncate">
                {w.next_episode ? `Empezar ${w.subtitle || 'el siguiente'}` : w.subtitle || '\u00a0'}
              </p>
            </button>
          ))}
        </Row>
      )}

      {/* Las filas de genero se piden de veinte en veinte al acercarse al final
          y sueltan las caratulas de la izquierda, asi que el carril no se
          acaba nunca y el movil no acumula mil nodos. */}
      {rows.map(r => (
        <Row key={r.genre} title={r.genre}
          onNearEnd={r.key ? () => cargarMas(r.genre, 1) : undefined}
          onNearStart={r.key ? () => cargarMas(r.genre, -1) : undefined}
          shift={r.shift}
          scrollX={scrollXDe(r.genre)}
          onScrollX={x => recordarScrollX(r.genre, x)}>
          {r.items.map(i => <Poster key={`${r.genre}-${i.id}`} to={link(i)} title={i.title} poster={i.poster} subtitle={i.media_type === 'series' && i.episode_count ? `${i.episode_count} ep.` : i.year ? String(i.year) : undefined} />)}
        </Row>
      ))}
      {loading && <p className="px-4 text-nf-text3 text-[14px]">Cargando…</p>}
      {!loading && rows.length === 0 && <p className="px-4 text-nf-text3 text-[14px]">Todavía no hay nada indexado.</p>}

      {playing && <Player path={playing.path} title={playing.title} subtitle={playing.subtitle} poster={playing.poster} backdrop={playing.backdrop}
        tmdbId={playing.tmdb_id ?? undefined} mediaType={playing.media_type}
        onClose={() => { setPlaying(null); continueWatching().then(setResume).catch(() => {}); }} />}
    </div>
  );
}
