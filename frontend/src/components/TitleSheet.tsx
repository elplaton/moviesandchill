import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useLibrary, type LocalFile } from '../contexts/LibraryContext';
import { useDownloads } from '../hooks/useDownloads';
import { groupEpisodes, groupVersions, episodeLabel, seasonLabel, type Episode, type Version } from '../utils/versions';
import Button from './ui/Button';
import Player from './Player';
import { IconCheck, IconClose, IconDownload, IconPlay, IconStar, IconTrash } from './ui/Icon';
import type { SearchResult, TMDBMetadata } from '../types';

export interface SheetInput {
  kind: 'movie' | 'series';
  tmdbId?: number;
  meta: TMDBMetadata;
  /** Archivos del catálogo (de /media/{id}/files o de una búsqueda). */
  files: SearchResult[];
}

interface Props { input: SheetInput; onClose: () => void }

type RowState = { s: 'ready'; f: LocalFile } | { s: 'busy'; label: string; progress: number; batchId: string } | { s: 'idle' };

/**
 * Ficha de un título, a pantalla casi completa.
 *
 * Sustituye a los dos modales anteriores (uno para películas y otro para
 * series, casi idénticos y de 2xl de ancho, donde la lista de episodios
 * quedaba en una columna estrechísima). Aquí caben el fondo, los datos y la
 * lista completa: a la izquierda el título, a la derecha lo descargable.
 */
export default function TitleSheet({ input, onClose }: Props) {
  const { meta, kind } = input;
  const isSeries = kind === 'series';
  const { refreshMe } = useAuth();
  const { localFor, remove, version } = useLibrary();
  const { downloadStates, download, cancelBatch } = useDownloads();
  const [season, setSeason] = useState<number | null | undefined>(undefined);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [playing, setPlaying] = useState<{ path: string; subtitle?: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [pick, setPick] = useState<{ variants: Version[]; subtitle?: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !playing && !pick) onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose, playing, pick]);

  const say = (m: string) => { setNotice(m); setTimeout(() => setNotice(''), 4000); };

  const versions = useMemo(() => groupVersions(input.files), [input.files]);
  const episodes = useMemo(() => (isSeries ? groupEpisodes(versions) : []), [versions, isSeries]);
  const seasons = useMemo(() => [...new Set(episodes.map(e => e.season))].sort((a, b) => (a ?? 999) - (b ?? 999)), [episodes]);
  const active = season === undefined ? seasons[0] : season;
  const shown = useMemo(() => episodes.filter(e => e.season === active), [episodes, active]);

  // Nombres de episodio de TMDB para la temporada abierta.
  useEffect(() => {
    if (!isSeries || !input.tmdbId || active == null || names.has(`${active}:_`)) return;
    apiFetch(`/tmdb/season?tmdb_id=${input.tmdbId}&season=${active}`)
      .then(r => r.json())
      .then(d => setNames(prev => {
        const n = new Map(prev); n.set(`${active}:_`, '');
        for (const ep of d.episodes || []) if (ep.name) n.set(`${active}:${ep.episode_number}`, ep.name);
        return n;
      }))
      .catch(() => {});
  }, [isSeries, input.tmdbId, active]); // eslint-disable-line react-hooks/exhaustive-deps

  const stateOf = useCallback((v: Version): RowState => {
    // Manda lo que dice el servidor (tabla de descargas); el índice local es el respaldo.
    if (v.localPath) return { s: 'ready', f: { name: v.localPath.split('/').pop() || v.fileName, path: v.localPath, owner: v.owner || 'admin', canDelete: !!v.canDelete } };
    const f = localFor(v.fileName, v.season, v.episode, meta.title);
    if (f) return { s: 'ready', f };
    const ds = downloadStates.get(v.messageId);
    if (ds && ['downloading', 'extracting', 'converting'].includes(ds.status)) {
      const label = ds.status === 'extracting' ? 'Extrayendo' : ds.status === 'converting' ? 'Convirtiendo' : `${ds.progress} %`;
      return { s: 'busy', label, progress: ds.progress, batchId: ds.batchId };
    }
    return { s: 'idle' };
  }, [localFor, downloadStates, meta.title, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = useCallback(async (v: Version, subtitle?: string) => {
    const st = stateOf(v);
    if (st.s === 'ready') { setPlaying({ path: st.f.path, subtitle }); return; }
    if (st.s === 'busy') { cancelBatch(st.batchId); say('Descarga cancelada'); return; }
    const err = await download(v.messageId, v.channelId);
    if (err) say(err); else { say(`Descargando ${v.baseName}`); refreshMe(); }
  }, [stateOf, download, cancelBatch, refreshMe]);

  const del = useCallback(async (f: LocalFile, label: string) => {
    if (!confirm(`¿Borrar "${label}" del servidor?`)) return;
    const err = await remove(f.path);
    if (err) say(err); else { say('Archivo borrado'); refreshMe(); }
  }, [remove, refreshMe]);

  const onEpisode = useCallback((e: Episode) => {
    const name = names.get(`${e.season}:${e.episode}`) || '';
    const subtitle = `${episodeLabel(e)}${name ? ` · ${name}` : ''}`;
    const ready = e.variants.find(v => stateOf(v).s === 'ready');
    if (ready) { act(ready, subtitle); return; }
    if (e.variants.length > 1) { setPick({ variants: e.variants, subtitle }); return; }
    act(e.variants[0], subtitle);
  }, [names, stateOf, act]);

  const playable = useMemo(() => {
    const ready = versions.map(v => ({ v, st: stateOf(v) })).find(x => x.st.s === 'ready');
    if (!ready || ready.st.s !== 'ready') return null;
    const sub = ready.v.episode !== undefined ? `${ready.v.season ?? 1}x${String(ready.v.episode).padStart(2, '0')}` : undefined;
    return { path: ready.st.f.path, subtitle: sub };
  }, [versions, stateOf]);

  const onDisk = versions.filter(v => stateOf(v).s === 'ready').length;
  const bg = (meta.backdrop || meta.poster || '').replace('/w780/', '/w1280/');
  const facts = [
    meta.year ? String(meta.year) : '',
    meta.genres?.slice(0, 3).join(' · ') || '',
    isSeries ? `${episodes.length} episodios` : `${versions.length} ${versions.length === 1 ? 'versión' : 'versiones'}`,
  ].filter(Boolean);

  /** Fila de la lista: episodio de una serie o versión de una película. */
  const Row = ({ label, title, sub, st, onEnter, onDelete }: {
    label: string; title: string; sub: string; st: RowState; onEnter: () => void; onDelete?: () => void;
  }) => (
    <div className="group flex items-center gap-4 rounded px-3 py-2.5 hover:bg-white/[0.06]">
      <span className="w-14 shrink-0 text-base font-semibold tabular-nums text-nf-faint">{label}</span>
      <button onClick={onEnter} className="min-w-0 flex-1 text-left">
        <p className="truncate text-base font-medium">{title}</p>
        <p className="truncate text-xs text-nf-faint">{sub}</p>
      </button>
      <div className="flex shrink-0 items-center gap-2">
        {st.s === 'busy' ? (
          <div className="w-32">
            <p className="mb-1 text-right text-xs text-nf-dim">{st.label}</p>
            <div className="h-1 overflow-hidden rounded-full bg-white/15"><div className="h-full bg-nf-red" style={{ width: `${st.progress}%` }} /></div>
          </div>
        ) : st.s === 'ready' ? (
          <Button variant="light" size="sm" icon={<IconPlay />} onClick={onEnter}>Ver</Button>
        ) : (
          <Button variant="ghost" size="sm" icon={<IconDownload />} onClick={onEnter}>Descargar</Button>
        )}
        {st.s === 'ready' && onDelete && (
          <button onClick={onDelete} title="Borrar del servidor"
            className="grid h-8 w-8 place-items-center rounded text-nf-faint opacity-0 transition-opacity hover:bg-nf-red/25 hover:text-white group-hover:opacity-100">
            <span className="w-4 h-4"><IconTrash /></span>
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-black/80 py-10" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="relative mx-auto w-[min(1180px,92vw)] overflow-hidden rounded-panel bg-nf-bg shadow-panel animate-scale-in">

        <button onClick={onClose} aria-label="Cerrar"
          className="absolute right-4 top-4 z-20 grid h-10 w-10 place-items-center rounded-full bg-black/70 hover:bg-white/20">
          <span className="w-5 h-5"><IconClose /></span>
        </button>

        <div className="relative h-[340px]">
          {bg && <img src={bg} alt="" className="absolute inset-0 h-full w-full object-cover object-top" />}
          <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, #141414 8%, rgba(20,20,20,0.55) 55%, rgba(20,20,20,0.2) 100%)' }} />
          <div className="absolute inset-x-0 bottom-0 h-32" style={{ background: 'linear-gradient(180deg, rgba(20,20,20,0), #141414)' }} />

          <div className="relative flex h-full max-w-[620px] flex-col justify-end p-9">
            <p className="mb-1.5 text-micro font-bold uppercase tracking-[0.18em] text-nf-red">{isSeries ? 'Serie' : 'Película'}</p>
            <h1 className="text-page font-bold line-clamp-2">{meta.title}</h1>
            <div className="mt-2.5 flex items-center gap-3 text-base text-nf-dim">
              {meta.rating ? <span className="inline-flex items-center gap-1.5 text-white"><span className="w-4 h-4 text-nf-warn"><IconStar /></span>{meta.rating.toFixed(1)}</span> : null}
              {facts.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-3">
                  {(i > 0 || meta.rating) && <span className="h-1 w-1 rounded-full bg-nf-faint" />}{f}
                </span>
              ))}
            </div>
            <div className="mt-5 flex items-center gap-3">
              {playable && <Button variant="light" icon={<IconPlay />} onClick={() => setPlaying(playable)}>Reproducir</Button>}
              {onDisk > 0 && (
                <span className="inline-flex items-center gap-1.5 text-base font-medium text-nf-ok">
                  <span className="w-4 h-4"><IconCheck /></span>{onDisk} en disco
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 px-9 pb-9 lg:grid-cols-[320px_1fr]">
          <div>
            {meta.overview && <p className="text-base leading-relaxed text-nf-dim">{meta.overview}</p>}
            {versions.length === 0 && <p className="mt-4 text-base text-nf-faint">No hay archivos indexados para este título.</p>}
          </div>

          <div className="min-w-0">
            {isSeries && seasons.length > 1 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {seasons.map(s => (
                  <button key={String(s)} onClick={() => setSeason(s)}
                    className={`h-8 rounded px-3.5 text-base font-medium transition-colors ${
                      s === active ? 'bg-white text-black' : 'bg-white/10 text-nf-dim hover:bg-white/20'}`}>
                    {seasonLabel(s)}
                  </button>
                ))}
              </div>
            )}
            {isSeries && seasons.length === 1 && <h2 className="mb-2 text-md font-semibold">{seasonLabel(seasons[0])}</h2>}
            {!isSeries && versions.length > 0 && <h2 className="mb-2 text-md font-semibold">Versiones disponibles</h2>}

            <div className="-mx-3 max-h-[46vh] overflow-y-auto pr-1">
              {isSeries && shown.map(e => {
                const best = e.variants.find(v => stateOf(v).s !== 'idle') || e.variants[0];
                const st = stateOf(best);
                const name = names.get(`${e.season}:${e.episode}`) || best.baseName;
                return (
                  <Row key={`${e.season}:${e.episode}`} label={episodeLabel(e)} title={name}
                    sub={`${best.quality} · ${best.sizeStr}${e.variants.length > 1 ? ` · ${e.variants.length} versiones` : ''}${best.channelName ? ` · ${best.channelName}` : ''}`}
                    st={st} onEnter={() => onEpisode(e)}
                    onDelete={st.s === 'ready' ? () => del(st.f, `${episodeLabel(e)} · ${name}`) : undefined} />
                );
              })}
              {!isSeries && versions.map(v => {
                const st = stateOf(v);
                return (
                  <Row key={v.key} label={v.quality.split(' · ')[0]} title={v.baseName}
                    sub={`${v.quality} · ${v.sizeStr}${v.parts > 1 ? ` · ${v.parts} partes` : ''}${v.channelName ? ` · ${v.channelName}` : ''}`}
                    st={st} onEnter={() => act(v)}
                    onDelete={st.s === 'ready' ? () => del(st.f, v.baseName) : undefined} />
                );
              })}
            </div>
          </div>
        </div>

        {notice && (
          <div className="absolute bottom-5 left-1/2 z-30 -translate-x-1/2 rounded bg-nf-raised px-5 py-3 text-base shadow-lift animate-slide-up">{notice}</div>
        )}
      </div>

      {pick && (
        <div className="fixed inset-0 z-[75] grid place-items-center bg-black/70 p-4" onClick={() => setPick(null)}>
          <div onClick={e => e.stopPropagation()} className="w-[min(520px,92vw)] rounded-panel bg-nf-surface p-6 shadow-panel animate-scale-in">
            <h3 className="mb-4 text-md font-semibold">Elige versión</h3>
            {pick.variants.map(v => (
              <button key={v.key} onClick={() => { setPick(null); act(v, pick.subtitle); }}
                className="flex w-full items-center justify-between gap-4 rounded px-3 py-3 text-left hover:bg-white/[0.06]">
                <span className="min-w-0">
                  <span className="block truncate text-base font-medium">{v.quality} · {v.sizeStr}</span>
                  <span className="block truncate text-xs text-nf-faint">{v.channelName}{v.parts > 1 ? ` · ${v.parts} partes` : ''}</span>
                </span>
                <span className="w-4 h-4 shrink-0 text-nf-faint"><IconDownload /></span>
              </button>
            ))}
          </div>
        </div>
      )}

      {playing && (
        <Player path={playing.path} title={meta.title} subtitle={playing.subtitle} onClose={() => setPlaying(null)} />
      )}
    </div>
  );
}
