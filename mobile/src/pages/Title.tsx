import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../services/api';
import { fetchMediaFiles } from '../services/media';
import { useLibrary, type LocalFile } from '../contexts/LibraryContext';
import { useAuth } from '../contexts/AuthContext';
import { toast } from '../utils/toast';
import { resumePoint } from '../utils/progress';
import { groupEpisodes, groupVersions, seasonLabel, episodeLabel, type Version } from '../utils/versions';
import Player from '../components/Player';
import { IBack, IPlay, IStar, ITrash } from '../components/Icons';
import type { DownloadState, SearchResult, TMDBMetadata } from '../types';

type RowState = { s: 'ready'; f: LocalFile } | { s: 'busy'; ds: DownloadState } | { s: 'idle' };

function Action({ state, onPlay, onDownload, onDelete, onManage }: {
  state: RowState; onPlay: () => void; onDownload: () => void; onDelete?: () => void; onManage: () => void;
}) {
  if (state.s === 'ready') {
    return (
      <div className="flex items-center gap-2 shrink-0">
        {!state.f.canDelete && <span className="text-[10px] text-nf-text3 max-w-[60px] truncate">de {state.f.owner}</span>}
        <button onClick={onPlay} className="tap h-9 px-3 rounded-full bg-white text-black text-[13px] font-semibold flex items-center gap-1 active:opacity-70"><span className="w-4 h-4"><IPlay /></span>Ver</button>
        {state.f.canDelete && onDelete && <button onClick={onDelete} className="tap w-9 h-9 rounded-full bg-white/10 text-nf-text2 flex items-center justify-center active:bg-nf-red/40"><span className="w-4 h-4"><ITrash /></span></button>}
      </div>
    );
  }
  if (state.s === 'busy') {
    const l = state.ds.status === 'extracting' ? 'Extrayendo' : state.ds.status === 'converting' ? 'Convirtiendo' : `${state.ds.progress} %`;
    return (
      <button onClick={onManage} className="shrink-0 w-[92px] text-right">
        <span className="block text-[12px] text-nf-text2 mb-1">{l}</span>
        <span className="block h-1.5 rounded-full bg-white/15 overflow-hidden"><span className="block h-full bg-nf-red" style={{ width: `${state.ds.progress}%` }} /></span>
      </button>
    );
  }
  return <button onClick={onDownload} className="tap h-9 px-3 rounded-full bg-nf-red text-white text-[13px] font-semibold shrink-0 active:bg-nf-reddeep">Descargar</button>;
}

/** Ficha de película o serie: info, temporadas, episodios/versiones y acciones. */
export default function Title() {
  const { kind = 'movie', id = '0' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { localFor, states, version, download, cancel, pause, remove } = useLibrary();
  const { refresh } = useAuth();
  const tmdbId = parseInt(id) || 0;
  const isSeries = kind === 'series';
  const [meta, setMeta] = useState<(TMDBMetadata & { tmdb_id?: number }) | null>(null);
  const [files, setFiles] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [season, setSeason] = useState<number | null | undefined>(undefined);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [playing, setPlaying] = useState<{ path: string; subtitle?: string } | null>(null);
  const [menu, setMenu] = useState<{ v: Version; ds: DownloadState } | null>(null);
  const [pick, setPick] = useState<{ variants: Version[]; subtitle?: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (tmdbId) {
          const d = await fetchMediaFiles(tmdbId, isSeries ? 'tv' : 'movie');
          setMeta(d.tmdb ? { ...d.tmdb, media_type: d.tmdb.media_type } : { title: params.get('q') || '' });
          setFiles(d.results);
        } else {
          const q = params.get('q') || '';
          const d = await (await apiFetch('/search', { method: 'POST', body: JSON.stringify({ query: q, page_size: 100 }) })).json();
          const list: SearchResult[] = d.results || [];
          const f = list[0];
          setMeta({ title: f?.tmdb_title || q, poster: f?.tmdb_poster, backdrop: f?.tmdb_backdrop, year: f?.tmdb_year, rating: f?.tmdb_rating, overview: f?.tmdb_overview, genres: f?.tmdb_genres });
          setFiles(list);
        }
      } catch { toast('No se ha podido cargar la ficha', 'error'); }
      finally { setLoading(false); }
    })();
    // `version` sube cuando termina una descarga o se borra algo: asi la ficha
    // abierta pasa sola de "Descargar" a "Ver" sin recargar la app.
  }, [tmdbId, isSeries, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const versions = useMemo(() => groupVersions(files), [files]);
  const episodes = useMemo(() => (isSeries ? groupEpisodes(versions) : []), [versions, isSeries]);
  const seasons = useMemo(() => [...new Set(episodes.map(e => e.season))].sort((a, b) => (a ?? 999) - (b ?? 999)), [episodes]);
  const active = season === undefined ? seasons[0] : season;
  const shown = episodes.filter(e => e.season === active);

  useEffect(() => {
    if (!isSeries || !tmdbId || active == null || names.has(`${active}:_`)) return;
    apiFetch(`/tmdb/season?tmdb_id=${tmdbId}&season=${active}`).then(r => r.json()).then(d => {
      setNames(prev => { const n = new Map(prev); n.set(`${active}:_`, ''); for (const ep of d.episodes || []) if (ep.name) n.set(`${active}:${ep.episode_number}`, ep.name); return n; });
    }).catch(() => {});
  }, [isSeries, tmdbId, active]); // eslint-disable-line react-hooks/exhaustive-deps

  const stateOf = useCallback((v: Version): RowState => {
    // Primero lo que dice el servidor (ruta y dueño en la tabla de descargas); si no, el indice local.
    if (v.localPath) return { s: 'ready', f: { name: v.localPath.split('/').pop() || v.fileName, path: v.localPath, owner: v.owner || 'admin', canDelete: !!v.canDelete } };
    const f = localFor(v.fileName, v.season, v.episode, meta?.title); if (f) return { s: 'ready', f };
    const ds = states.get(v.messageId);
    if (ds && ['downloading', 'extracting', 'converting'].includes(ds.status)) return { s: 'busy', ds };
    return { s: 'idle' };
  }, [localFor, states, meta]);

  const act = useCallback(async (v: Version, subtitle?: string) => {
    const st = stateOf(v);
    if (st.s === 'ready') { setPlaying({ path: st.f.path, subtitle }); return; }
    if (st.s === 'busy') { setMenu({ v, ds: st.ds }); return; }
    const err = await download(v.messageId, v.channelId);
    if (err) toast(err, 'error', 5000); else { toast(`Descargando ${v.baseName}`); refresh(); }
  }, [stateOf, download, refresh]);

  const del = useCallback(async (f: LocalFile) => {
    if (!confirm(`¿Borrar "${f.name}" del servidor?`)) return;
    const err = await remove(f.path);
    if (err) toast(err, 'error', 5000); else { toast('Borrado', 'ok'); refresh(); }
  }, [remove, refresh]);

  const playable = useMemo(() => {
    const ready = versions.map(v => ({ v, f: v.localPath ? { name: v.fileName, path: v.localPath, owner: v.owner || 'admin', canDelete: !!v.canDelete } : localFor(v.fileName, v.season, v.episode, meta?.title) })).filter(x => x.f) as { v: Version; f: LocalFile }[];
    if (!ready.length) return null;
    const r = ready.find(x => resumePoint(x.f.path) > 0) || ready[0];
    return { path: r.f.path, resume: !!ready.find(x => resumePoint(x.f.path) > 0), subtitle: r.v.episode !== undefined ? `${r.v.season ?? ''}x${String(r.v.episode).padStart(2, '0')}` : undefined };
  }, [versions, localFor, meta]);

  const bg = meta?.backdrop || meta?.poster;
  const info = [meta?.year, meta?.genres?.slice(0, 2).join(', '), isSeries ? `${episodes.length} episodios` : `${versions.length} ${versions.length === 1 ? 'versión' : 'versiones'}`].filter(Boolean).join(' · ');

  return (
    <div className="min-h-screen pb-10">
      <div className="relative h-[60vw] max-h-[400px]">
        {bg && <img src={bg} alt="" className="absolute inset-0 w-full h-full object-cover" />}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(20,20,20,0.35) 0%, rgba(20,20,20,0) 35%, #141414 100%)' }} />
        <button onClick={() => navigate(-1)} className="absolute left-3 w-10 h-10 rounded-full bg-black/50 flex items-center justify-center tap" style={{ top: 'calc(var(--safe-t) + 10px)' }}><span className="w-5 h-5"><IBack /></span></button>
      </div>
      <div className="px-4 -mt-10 relative">
        <p className="text-[11px] font-semibold text-nf-text3 tracking-wide">{isSeries ? 'SERIE' : 'PELÍCULA'}</p>
        <h1 className="text-[26px] font-bold leading-tight">{meta?.title || '…'}</h1>
        <p className="text-[13px] text-nf-text2 mt-1 flex items-center gap-1.5">
          {meta?.rating ? <span className="inline-flex items-center gap-1 text-white"><span className="w-3.5 h-3.5 text-nf-warn"><IStar /></span>{meta.rating.toFixed(1)}</span> : null}
          {meta?.rating && info ? <span>·</span> : null}<span>{info}</span>
        </p>
        {meta?.overview && <p className="text-[14px] text-nf-text2 leading-relaxed mt-3 line-clamp-5">{meta.overview}</p>}
        {playable && (
          <button onClick={() => setPlaying({ path: playable.path, subtitle: playable.subtitle })} className="mt-4 w-full h-12 rounded-xl bg-white text-black font-semibold text-[16px] flex items-center justify-center gap-2 active:opacity-80">
            <span className="w-5 h-5"><IPlay /></span>{playable.resume ? 'Continuar viendo' : 'Reproducir'}
          </button>
        )}
      </div>

      <div className="mt-6">
        {isSeries && seasons.length > 1 && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar px-4 mb-3">
            {seasons.map(s => (
              <button key={String(s)} onClick={() => setSeason(s)} className={`shrink-0 h-9 px-4 rounded-full text-[13px] font-semibold ${s === active ? 'bg-white text-black' : 'bg-white/10 text-nf-text2'}`}>{seasonLabel(s)}</button>
            ))}
          </div>
        )}
        {isSeries && seasons.length === 1 && <h2 className="px-4 mb-2 text-[17px] font-semibold">{seasonLabel(seasons[0])}</h2>}
        {!isSeries && versions.length > 0 && <h2 className="px-4 mb-2 text-[17px] font-semibold">Versiones</h2>}

        {isSeries && shown.map(e => {
          const best = e.variants.find(v => stateOf(v).s !== 'idle') || e.variants[0];
          const st = stateOf(best);
          const name = names.get(`${e.season}:${e.episode}`) || best.baseName;
          const sub = `${episodeLabel(e)} · ${name}`;
          return (
            <div key={`${e.season}:${e.episode}`} className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5">
              <span className="w-10 shrink-0 text-[13px] text-nf-text3 font-semibold tabular-nums">{episodeLabel(e)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-medium truncate">{name}</p>
                <p className="text-[12px] text-nf-text3 truncate">{best.quality} · {best.sizeStr}{e.variants.length > 1 ? ` · ${e.variants.length} versiones` : ''}</p>
              </div>
              <Action state={st}
                onPlay={() => st.s === 'ready' && setPlaying({ path: st.f.path, subtitle: sub })}
                onDelete={st.s === 'ready' ? () => del(st.f) : undefined}
                onManage={() => st.s === 'busy' && setMenu({ v: best, ds: st.ds })}
                onDownload={() => e.variants.length > 1 ? setPick({ variants: e.variants, subtitle: sub }) : act(best, sub)} />
            </div>
          );
        })}
        {!isSeries && versions.map(v => {
          const st = stateOf(v);
          return (
            <div key={v.key} className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5">
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-medium truncate">{v.baseName}</p>
                <p className="text-[12px] text-nf-text3 truncate">{v.quality} · {v.sizeStr}{v.parts > 1 ? ` · ${v.parts} partes` : ''} · {v.channelName}</p>
              </div>
              <Action state={st} onPlay={() => st.s === 'ready' && setPlaying({ path: st.f.path })} onDelete={st.s === 'ready' ? () => del(st.f) : undefined}
                onManage={() => st.s === 'busy' && setMenu({ v, ds: st.ds })} onDownload={() => act(v)} />
            </div>
          );
        })}
        {!loading && versions.length === 0 && <p className="px-4 text-[14px] text-nf-text3">No hay archivos indexados para este título.</p>}
        {loading && <p className="px-4 text-[14px] text-nf-text3">Cargando…</p>}
      </div>

      {pick && (
        <div className="fixed inset-0 z-[65] bg-black/70 flex items-end" onClick={() => setPick(null)}>
          <div className="w-full bg-nf-raised rounded-t-2xl p-4 rise" style={{ paddingBottom: 'calc(16px + var(--safe-b))' }} onClick={e => e.stopPropagation()}>
            <p className="text-[15px] font-semibold mb-3">Elige versión</p>
            {pick.variants.map(v => (
              <button key={v.key} onClick={() => { setPick(null); act(v, pick.subtitle); }} className="w-full text-left py-3 border-b border-white/10 last:border-0">
                <p className="text-[15px]">{v.quality} · {v.sizeStr}</p><p className="text-[12px] text-nf-text3">{v.channelName}{v.parts > 1 ? ` · ${v.parts} partes` : ''}</p>
              </button>
            ))}
          </div>
        </div>
      )}
      {menu && (
        <div className="fixed inset-0 z-[65] bg-black/70 flex items-end" onClick={() => setMenu(null)}>
          <div className="w-full bg-nf-raised rounded-t-2xl p-4 rise" style={{ paddingBottom: 'calc(16px + var(--safe-b))' }} onClick={e => e.stopPropagation()}>
            <p className="text-[15px] font-semibold">{menu.v.baseName}</p>
            <p className="text-[13px] text-nf-text2 mb-3">{menu.ds.progress} %{menu.ds.downloadedStr ? ` · ${menu.ds.downloadedStr} / ${menu.ds.totalStr}` : ''}</p>
            <button onClick={() => { pause(menu.ds.batchId); setMenu(null); toast('Descarga pausada'); }} className="w-full h-12 rounded-xl bg-white/10 text-[15px] font-medium mb-2">Pausar</button>
            <button onClick={() => { cancel(menu.ds.batchId); setMenu(null); toast('Descarga cancelada'); }} className="w-full h-12 rounded-xl bg-nf-red/20 text-red-300 text-[15px] font-medium">Cancelar descarga</button>
          </div>
        </div>
      )}
      {playing && <Player path={playing.path} title={meta?.title || ''} subtitle={playing.subtitle} poster={meta?.poster} backdrop={meta?.backdrop} onClose={() => setPlaying(null)} />}
    </div>
  );
}
