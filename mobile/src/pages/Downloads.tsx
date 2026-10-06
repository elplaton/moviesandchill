import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLibrary, type LocalFile, type LocalTitle } from '../contexts/LibraryContext';
import { useAuth } from '../contexts/AuthContext';
import { fetchMetadataBatch } from '../services/tmdb';
import { cleanTitle } from '../utils/text';
import { toast } from '../utils/toast';
import Player from '../components/Player';
import { IPlay, IStar, ITrash } from '../components/Icons';
import type { TMDBMetadata } from '../types';

const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GB`;
const epLabel = (f: LocalFile) => f.episode != null ? `${f.season ?? 1}x${String(f.episode).padStart(2, '0')}` : '';

function Section({ title, count, children }: { title: string; count?: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <div className="flex items-baseline justify-between px-4 mb-1.5">
        <h2 className="text-[13px] font-semibold text-nf-text2 uppercase tracking-wide">{title}</h2>
        {count && <span className="text-[12px] text-nf-text3">{count}</span>}
      </div>
      {children}
    </section>
  );
}

/** Carátula 2:3 con hueco reservado: si TMDB no la conoce, sale el título. */
function Caratula({ poster, title, className = '' }: { poster?: string; title: string; className?: string }) {
  return (
    <div className={`relative shrink-0 overflow-hidden rounded-lg bg-nf-card ${className}`}>
      {poster
        ? <img src={poster} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
        : <span className="absolute inset-0 p-1.5 flex items-end text-[10px] font-semibold leading-tight text-nf-text2 line-clamp-4">{title}</span>}
    </div>
  );
}

/**
 * Descargas: lo que esta bajando, lo pausado y lo que hay en el servidor.
 *
 * Las series **no se despliegan aqui**: llevan a su ficha, que es la pantalla
 * con todos los episodios y desde donde se bajan los que faltan. Plegarlas
 * dentro de la lista obligaba a desplegar, mirar y volver a plegar para pasar
 * de una a otra.
 */
export default function Downloads() {
  const { titles, batches, paused, cancel, pause, resume, remove, loadStatus } = useLibrary();
  const { me, refresh } = useAuth();
  const [playing, setPlaying] = useState<LocalFile | null>(null);
  const [filter, setFilter] = useState<'all' | 'mine'>('all');
  const [metas, setMetas] = useState<Map<string, TMDBMetadata>>(new Map());
  const [hoja, setHoja] = useState<{ titulo: string; versiones: LocalFile[] } | null>(null);

  const active = batches.filter(b => ['downloading', 'extracting', 'converting'].includes(b.status));
  const mine = (t: LocalTitle) => t.isSeries ? t.episodes.some(e => e.owner === me?.username) : t.versions.some(v => v.owner === me?.username);
  const visible = titles.filter(t => filter === 'all' || mine(t));
  const series = visible.filter(t => t.isSeries).sort((a, b) => a.cleanName.localeCompare(b.cleanName));
  const movies = visible.filter(t => !t.isSeries).sort((a, b) => a.cleanName.localeCompare(b.cleanName));
  const metaDe = (t: LocalTitle) => metas.get(t.cleanName);

  // Al abrir la pantalla se pregunta por lo que esta bajando: el WebSocket se
  // cae cuando el telefono suspende la app y, sin esto, la lista de descargas
  // en curso podia estar vacia aunque hubiera alguna.
  useEffect(() => { loadStatus(); }, [loadStatus]);

  useEffect(() => {
    const nombres = [...new Set(titles.map(t => t.cleanName).filter(Boolean))];
    if (!nombres.length) return;
    let vivo = true;
    fetchMetadataBatch(nombres).then(m => { if (vivo) setMetas(new Map(m)); }).catch(() => {});
    return () => { vivo = false; };
  }, [titles]);

  const del = async (f: LocalFile) => {
    if (!confirm(`¿Borrar "${f.name}" del servidor?`)) return;
    const err = await remove(f.path);
    if (err) toast(err, 'error', 5000);
    else { toast('Borrado', 'ok'); refresh(); setHoja(null); }
  };
  const pct = me?.quota_bytes ? Math.min(100, Math.round((me.used_bytes / me.quota_bytes) * 100)) : 0;

  // De que titulo es el archivo que se esta reproduciendo. La caratula y el id
  // de TMDB se guardan junto a la posicion, y son lo que hace que la tarjeta
  // de "Continuar viendo" tenga imagen en vez de solo el titulo escrito.
  const tituloEnJuego = playing
    ? titles.find(t => t.versions.includes(playing) || t.episodes.includes(playing))
    : undefined;
  const fichaEnJuego = tituloEnJuego ? metaDe(tituloEnJuego) : undefined;

  /** A dónde lleva una serie: a su ficha si TMDB la conoce. */
  const fichaDe = (t: LocalTitle) => {
    const id = metaDe(t)?.tmdb_id;
    return id ? `/t/series/${id}` : null;
  };

  const abrirPelicula = (t: LocalTitle, titulo: string) => {
    if (t.versions.length > 1) { setHoja({ titulo, versiones: t.versions }); return; }
    if (t.versions[0]) setPlaying(t.versions[0]);
  };

  return (
    <div className="pb-6">
      <div className="px-4 pb-4" style={{ paddingTop: 'calc(var(--safe-t) + 20px)' }}>
        <h1 className="text-[28px] font-bold">Descargas</h1>
        <p className="text-[12px] text-nf-text2 mt-2 mb-1">{me?.quota_bytes ? `${gb(me.used_bytes)} de ${gb(me.quota_bytes)} (${pct} %)` : `${gb(me?.used_bytes || 0)} en disco · sin límite`}</p>
        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className={`h-full ${pct >= 90 ? 'bg-nf-red' : 'bg-nf-ok'}`} style={{ width: `${me?.quota_bytes ? pct : 5}%` }} /></div>
        <div className="mt-3 flex rounded-full bg-white/10 p-0.5 text-[12px] w-max">
          <button onClick={() => setFilter('all')} className={`px-4 h-8 rounded-full ${filter === 'all' ? 'bg-white text-black' : 'text-nf-text2'}`}>Todo</button>
          <button onClick={() => setFilter('mine')} className={`px-4 h-8 rounded-full ${filter === 'mine' ? 'bg-white text-black' : 'text-nf-text2'}`}>Lo mío</button>
        </div>
      </div>

      {active.length > 0 && (
        <Section title="Descargando" count={`${active.length}`}>
          {active.map(b => {
            const l = b.status === 'extracting' ? 'Extrayendo' : b.status === 'converting' ? 'Convirtiendo' : `${b.downloaded_parts}/${b.total_parts} partes`;
            const canManage = !b.owner || b.owner === me?.username || me?.role === 'admin';
            const meta = metas.get(cleanTitle(b.folder_name));
            return (
              <div key={b.batch_id} className="px-4 py-3 border-b border-white/5">
                <div className="flex items-center gap-3">
                  <Caratula poster={meta?.poster} title={cleanTitle(b.folder_name)} className="w-[46px] h-[69px]" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-medium truncate">{cleanTitle(b.folder_name)}</p>
                    <p className="text-[12px] text-nf-text3 truncate">
                      {l}{b.owner && b.owner !== me?.username ? ` · ${b.owner}` : ''}
                    </p>
                    {/* Lo descargado, a qué velocidad y lo que queda. */}
                    <p className="text-[11px] text-nf-text3 truncate tabular-nums">
                      {b.downloaded_size_str ? `${b.downloaded_size_str} de ${b.total_size_str}` : b.total_size_str}
                      {b.speed_str ? ` · ${b.speed_str}` : ''}
                      {b.eta_str ? ` · faltan ${b.eta_str}` : ''}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full bg-nf-red transition-[width] duration-500" style={{ width: `${b.progress}%` }} />
                      </div>
                      <span className="text-[12px] tabular-nums text-nf-text2 w-10 text-right">{b.progress} %</span>
                    </div>
                  </div>
                </div>
                {canManage && b.status === 'downloading' && (
                  <div className="flex gap-2 mt-2.5">
                    <button onClick={() => { pause(b.batch_id); toast('Pausada'); }} className="tap flex-1 h-9 rounded-full bg-white/10 text-[13px]">Pausar</button>
                    <button onClick={() => { cancel(b.batch_id); toast('Cancelada'); }} className="tap flex-1 h-9 rounded-full bg-nf-red/20 text-red-300 text-[13px]">Cancelar</button>
                  </div>
                )}
              </div>
            );
          })}
        </Section>
      )}

      {paused.length > 0 && (
        <Section title="Pausadas" count={`${paused.length}`}>
          {paused.map((b: any) => (
            <div key={b.batch_id} className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-white/5">
              <div className="min-w-0"><p className="text-[15px] font-medium truncate">{cleanTitle(b.folder_name)}</p><p className="text-[12px] text-nf-text3">{b.total_parts} partes · {b.total_size_str}</p></div>
              <button onClick={() => { resume(b.batch_id); toast('Reanudando'); }} className="tap h-9 px-3 rounded-full bg-white text-black text-[13px] font-semibold shrink-0">Reanudar</button>
            </div>
          ))}
        </Section>
      )}

      {series.length > 0 && (
        <Section title="Series" count={`${series.length}`}>
          {series.map(t => {
            const m = metaDe(t);
            const titulo = m?.title || t.cleanName;
            const ficha = fichaDe(t);
            const dentro = (
              <>
                <Caratula poster={m?.poster} title={titulo} className="w-[52px] h-[78px]" />
                <div className="flex-1 min-w-0">
                  <p className="text-[16px] font-semibold truncate">{titulo}</p>
                  <p className="text-[12px] text-nf-text3 truncate">
                    {t.episodes.length} {t.episodes.length === 1 ? 'episodio' : 'episodios'} en disco
                  </p>
                  <p className="text-[12px] text-nf-text3 truncate">{t.size ? `${t.size} · ` : ''}{t.owner}</p>
                </div>
                <span className="w-5 h-5 shrink-0 text-nf-text3">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg>
                </span>
              </>
            );
            const clase = 'w-full flex items-center gap-3 px-4 py-3 text-left active:bg-white/5 border-b border-white/5';
            // Sin ficha de TMDB no hay pantalla a la que ir: se reproduce el
            // primer episodio en vez de dejar la fila muerta.
            return ficha
              ? <Link key={t.path} to={ficha} className={clase}>{dentro}</Link>
              : <button key={t.path} onClick={() => t.episodes[0] && setPlaying(t.episodes[0])} className={clase}>{dentro}</button>;
          })}
        </Section>
      )}

      {movies.length > 0 && (
        <Section title="Películas" count={`${movies.length}`}>
          <div className="grid grid-cols-3 gap-3 px-4">
            {movies.map(t => {
              const m = metaDe(t);
              const titulo = m?.title || t.cleanName;
              const varias = t.versions.length > 1;
              return (
                <div key={t.path}>
                  <div className="relative">
                    <button onClick={() => abrirPelicula(t, titulo)} aria-label={`Ver ${titulo}`} className="block w-full active:opacity-70">
                      <Caratula poster={m?.poster} title={titulo} className="w-full aspect-[2/3]" />
                      <span className="absolute inset-0 flex items-center justify-center">
                        <span className="w-9 h-9 rounded-full bg-black/55 flex items-center justify-center"><span className="w-4 h-4 ml-0.5"><IPlay /></span></span>
                      </span>
                    </button>
                    {m?.rating ? (
                      <span className="absolute top-1 left-1 inline-flex items-center gap-0.5 rounded bg-black/75 px-1 py-0.5 text-[10px] font-bold text-nf-warn pointer-events-none">
                        <span className="w-2.5 h-2.5"><IStar /></span>{m.rating.toFixed(1)}
                      </span>
                    ) : null}
                    {varias ? (
                      <span className="absolute bottom-1 left-1 right-1 rounded bg-black/80 px-1 py-0.5 text-[10px] font-semibold text-center pointer-events-none">
                        {t.versions.length} versiones
                      </span>
                    ) : t.versions[0]?.canDelete && (
                      <button onClick={() => del(t.versions[0])} aria-label={`Borrar ${titulo}`}
                        className="tap absolute top-1 right-1 w-8 h-8 rounded-full bg-black/70 text-nf-text2 flex items-center justify-center active:bg-nf-red/60">
                        <span className="w-4 h-4"><ITrash /></span>
                      </button>
                    )}
                  </div>
                  <p className="mt-1.5 text-[12px] font-medium leading-tight line-clamp-2">{titulo}</p>
                  <p className="text-[11px] text-nf-text3 truncate">{t.size} · {t.owner}</p>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {titles.length === 0 && active.length === 0 && <p className="px-4 pt-4 text-[14px] text-nf-text3">Todavía no hay nada descargado.</p>}
      {titles.length > 0 && visible.length === 0 && <p className="px-4 pt-4 text-[14px] text-nf-text3">No has descargado nada todavía.</p>}

      {/* Varias calidades de la misma película: cada una se ve y se borra por
          su cuenta, que es justo lo que antes no se podía. */}
      {hoja && (
        <div className="fixed inset-0 z-[65] bg-black/70 flex items-end" onClick={() => setHoja(null)}>
          <div className="w-full bg-nf-raised rounded-t-2xl p-4 rise" style={{ paddingBottom: 'calc(16px + var(--safe-b))' }} onClick={e => e.stopPropagation()}>
            <p className="text-[15px] font-semibold mb-1">{hoja.titulo}</p>
            <p className="text-[12px] text-nf-text3 mb-3">{hoja.versiones.length} versiones en el servidor</p>
            {hoja.versiones.map(v => (
              <div key={v.path} className="flex items-center gap-3 py-2.5 border-b border-white/10 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-medium truncate">{v.quality || v.name}</p>
                  <p className="text-[12px] text-nf-text3 truncate">{v.size} · {v.owner}</p>
                </div>
                <button onClick={() => { setHoja(null); setPlaying(v); }} className="tap h-9 px-4 rounded-full bg-white text-black text-[13px] font-semibold flex items-center gap-1 shrink-0">
                  <span className="w-4 h-4"><IPlay /></span>Ver
                </button>
                {v.canDelete && (
                  <button onClick={() => del(v)} aria-label={`Borrar ${v.quality || v.name}`}
                    className="tap w-9 h-9 rounded-full bg-white/10 text-nf-text2 flex items-center justify-center shrink-0 active:bg-nf-red/40">
                    <span className="w-4 h-4"><ITrash /></span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {playing && <Player path={playing.path} title={playing.series || cleanTitle(playing.name)} subtitle={epLabel(playing) || undefined}
        poster={fichaEnJuego?.poster} backdrop={fichaEnJuego?.backdrop}
        tmdbId={fichaEnJuego?.tmdb_id} mediaType={tituloEnJuego?.isSeries ? 'series' : 'movie'}
        onClose={() => setPlaying(null)} />}
    </div>
  );
}
