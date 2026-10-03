import { useEffect, useMemo, useState } from 'react';
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
 * Una serie: carátula, título y, al tocarla, sus episodios por temporada.
 * Es la misma ficha plegable que en escritorio, con la imagen delante para
 * poder reconocer la serie de un vistazo en vez de leer el nombre.
 */
function SeriesRow({ t, meta, onPlay, onDelete }: {
  t: LocalTitle; meta?: TMDBMetadata; onPlay: (f: LocalFile) => void; onDelete: (f: LocalFile) => void;
}) {
  const [open, setOpen] = useState(false);
  const seasons = useMemo(() => {
    const m = new Map<number, LocalFile[]>();
    for (const e of t.episodes) { const s = e.season ?? 1; if (!m.has(s)) m.set(s, []); m.get(s)!.push(e); }
    for (const list of m.values()) list.sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [t.episodes]);
  const owners = [...new Set(t.episodes.map(e => e.owner))];
  const titulo = meta?.title || t.cleanName;

  return (
    <div className="border-b border-white/5">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-white/5">
        <Caratula poster={meta?.poster} title={titulo} className="w-[52px] h-[78px]" />
        <div className="flex-1 min-w-0">
          <p className="text-[16px] font-semibold truncate">{titulo}</p>
          <p className="text-[12px] text-nf-text3 truncate">
            {t.episodes.length} {t.episodes.length === 1 ? 'episodio' : 'episodios'}
            {seasons.length > 1 ? ` · ${seasons.length} temporadas` : ''}
          </p>
          <p className="text-[12px] text-nf-text3 truncate">
            {t.size ? `${t.size} · ` : ''}{owners.length === 1 ? owners[0] : `${owners.length} cuentas`}
          </p>
        </div>
        <span className={`w-5 h-5 shrink-0 text-nf-text3 transition-transform ${open ? 'rotate-90' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg>
        </span>
      </button>
      {open && seasons.map(([n, eps]) => (
        <div key={n}>
          <p className="px-4 pt-2 pb-1 text-[12px] font-semibold text-nf-text3">Temporada {n}</p>
          {eps.map(e => (
            <div key={e.path} className="flex items-center gap-3 pl-4 pr-3 py-2 bg-white/[0.02]">
              <span className="w-12 shrink-0 text-[13px] text-nf-text3 font-semibold tabular-nums">{epLabel(e)}</span>
              <div className="flex-1 min-w-0"><p className="text-[14px] truncate">{e.size}</p><p className="text-[11px] text-nf-text3 truncate">{e.owner}</p></div>
              <button onClick={() => onPlay(e)} className="tap w-9 h-9 rounded-full bg-white text-black flex items-center justify-center shrink-0"><span className="w-4 h-4 ml-0.5"><IPlay /></span></button>
              {e.canDelete && <button onClick={() => onDelete(e)} className="tap w-9 h-9 rounded-full bg-white/10 text-nf-text2 flex items-center justify-center shrink-0 active:bg-nf-red/40"><span className="w-4 h-4"><ITrash /></span></button>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Descargas: lo que esta bajando, lo pausado y lo que hay en el servidor,
 * separado en series (plegables, por temporada) y peliculas.
 *
 * Las caratulas salen de TMDB por el nombre de la carpeta, igual que en
 * escritorio: en disco solo hay nombres de archivo, y una lista de texto no
 * se reconoce de un vistazo.
 */
export default function Downloads() {
  const { titles, batches, paused, states, cancel, pause, resume, remove } = useLibrary();
  const { me, refresh } = useAuth();
  const [playing, setPlaying] = useState<LocalFile | null>(null);
  const [filter, setFilter] = useState<'all' | 'mine'>('all');
  const [metas, setMetas] = useState<Map<string, TMDBMetadata>>(new Map());

  const active = batches.filter(b => ['downloading', 'extracting', 'converting'].includes(b.status));
  const mine = (t: LocalTitle) => t.isSeries ? t.episodes.some(e => e.owner === me?.username) : t.owner === me?.username;
  const visible = titles.filter(t => filter === 'all' || mine(t));
  const series = visible.filter(t => t.isSeries).sort((a, b) => a.cleanName.localeCompare(b.cleanName));
  const movies = visible.filter(t => !t.isSeries).sort((a, b) => a.cleanName.localeCompare(b.cleanName));
  const metaDe = (t: LocalTitle) => metas.get(t.cleanName);

  useEffect(() => {
    const nombres = [...new Set(titles.map(t => t.cleanName).filter(Boolean))];
    if (!nombres.length) return;
    let vivo = true;
    fetchMetadataBatch(nombres).then(m => { if (vivo) setMetas(new Map(m)); }).catch(() => {});
    return () => { vivo = false; };
  }, [titles]);

  const del = async (f: LocalFile) => {
    if (!confirm(`¿Borrar "${f.name}" del servidor?`)) return;
    const err = await remove(f.path); if (err) toast(err, 'error', 5000); else { toast('Borrado', 'ok'); refresh(); }
  };
  const pct = me?.quota_bytes ? Math.min(100, Math.round((me.used_bytes / me.quota_bytes) * 100)) : 0;

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
            const l = b.status === 'extracting' ? 'Extrayendo' : b.status === 'converting' ? 'Convirtiendo' : `${b.progress} % · ${b.downloaded_parts}/${b.total_parts} partes`;
            const ds = [...states.values()].find(s => s.batchId === b.batch_id);
            const canManage = !b.owner || b.owner === me?.username || me?.role === 'admin';
            return (
              <div key={b.batch_id} className="px-4 py-2.5 border-b border-white/5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium truncate">{cleanTitle(b.folder_name)}</p>
                    <p className="text-[12px] text-nf-text3">{l}{ds?.speed ? ` · ${ds.speed}` : ''}{b.owner && b.owner !== me?.username ? ` · ${b.owner}` : ''}</p>
                  </div>
                  {canManage && b.status === 'downloading' && (
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => { pause(b.batch_id); toast('Pausada'); }} className="tap h-9 px-3 rounded-full bg-white/10 text-[13px]">Pausar</button>
                      <button onClick={() => { cancel(b.batch_id); toast('Cancelada'); }} className="tap h-9 px-3 rounded-full bg-nf-red/20 text-red-300 text-[13px]">Cancelar</button>
                    </div>
                  )}
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-nf-red" style={{ width: `${b.progress}%` }} /></div>
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
          {series.map(t => <SeriesRow key={t.path} t={t} meta={metaDe(t)} onPlay={setPlaying} onDelete={del} />)}
        </Section>
      )}

      {movies.length > 0 && (
        <Section title="Películas" count={`${movies.length}`}>
          {/* Rejilla de carátulas, como la de escritorio: en el teléfono caben
              tres por fila y se reconocen sin leer. */}
          <div className="grid grid-cols-3 gap-3 px-4">
            {movies.map(t => {
              const m = metaDe(t);
              const titulo = m?.title || t.cleanName;
              return (
                <div key={t.path}>
                  {/* Borrar va encima de la carátula, como en escritorio: debajo
                      sería un segundo botón por película y tres por fila. */}
                  <div className="relative">
                    <button onClick={() => t.file && setPlaying(t.file)} aria-label={`Ver ${titulo}`} className="block w-full active:opacity-70">
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
                    {t.canDelete && t.file && (
                      <button onClick={() => del(t.file!)} aria-label={`Borrar ${titulo}`}
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

      {playing && <Player path={playing.path} title={playing.series || cleanTitle(playing.name)} subtitle={epLabel(playing) || undefined} onClose={() => setPlaying(null)} />}
    </div>
  );
}
