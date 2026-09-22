import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getElement, setFocus } from '../focus/engine';
import { FocusScope, useBackHandler, useFocusItem } from '../focus/react';
import { apiFetch, streamUrl } from '../services/api';
import { useDownloadsCtx } from '../contexts/DownloadsContext';
import { toast } from '../tv/toast';
import { resumePoint } from '../tv/progress';
import { bigBackdrop } from './Hero';
import Dialog from './Dialog';
import Overlay from './Overlay';
import Player from './Player';
import TvButton from './TvButton';
import { IconCheck, IconDownload, IconPlay, IconStar, IconTrash } from './Icons';
import { groupEpisodes, groupVersions, seasonLabel, episodeLabel, type Episode, type Version } from '../utils/versions';
import type { DownloadState, Featured, SearchResult } from '../types';

export interface DetailInput {
  kind: 'movie' | 'series';
  tmdbId?: number;
  meta: Featured;
  /** Archivos indexados (de /media/{id}/files o de una busqueda). */
  files: SearchResult[];
  /** Archivos ya en disco (biblioteca). */
  local?: { name: string; path: string; size: string }[];
}

interface Props { input: DetailInput; onClose: () => void }

type RowState = { status: 'ready'; path: string } | { status: 'busy'; ds: DownloadState } | { status: 'idle' };

function stateLabel(ds: DownloadState): string {
  if (ds.status === 'extracting') return 'Extrayendo';
  if (ds.status === 'converting') return 'Convirtiendo';
  if (ds.status === 'error') return 'Error';
  return `${ds.progress}%`;
}

function Chip({ label, index, selected, onSelect }: { label: string; index: number; selected: boolean; onSelect: () => void }) {
  const { ref } = useFocusItem<HTMLDivElement>({ index, onEnter: onSelect, onFocus: onSelect });
  return (
    <div ref={ref} className={`tv-chip ${selected ? 'is-selected' : ''} relative px-5 h-[52px] flex items-center rounded-lg text-body font-semibold whitespace-nowrap`}>
      {label}
    </div>
  );
}

function DeleteButton({ focusKey, onDelete }: { focusKey: string; onDelete: () => void }) {
  const { ref } = useFocusItem<HTMLDivElement>({ index: 1, focusKey, onEnter: onDelete });
  return (
    <div ref={ref} onClick={(e) => { e.stopPropagation(); onDelete(); }}
      className="tv-row-item shrink-0 w-[84px] h-[84px] rounded-lg mb-[10px] flex flex-col items-center justify-center text-tv-text2">
      <span className="w-7 h-7"><IconTrash /></span>
      <span className="text-[14px] font-semibold mt-1">Borrar</span>
    </div>
  );
}

/**
 * Fila de episodio o version. Es un carril horizontal de una o dos casillas:
 * la accion principal (reproducir/descargar) y, si el archivo esta en disco,
 * Borrar al lado. Arriba y abajo cambian de fila; izquierda y derecha, de casilla.
 */
function ListRow({ index, focusKey, label, title, meta, state, variants, onEnter, onDelete, autoFocus }: {
  index: number; focusKey: string; label: string; title: string; meta: string; state: RowState; variants: number;
  onEnter: () => void; onDelete?: () => void; autoFocus?: boolean;
}) {
  return (
    <FocusScope index={index} orientation="horizontal" className="flex items-stretch gap-[10px]">
      <MainCell focusKey={focusKey} label={label} title={title} meta={meta} state={state} variants={variants} onEnter={onEnter} autoFocus={autoFocus} />
      {state.status === 'ready' && onDelete && <DeleteButton focusKey={`${focusKey}-del`} onDelete={onDelete} />}
    </FocusScope>
  );
}

function MainCell({ focusKey, label, title, meta, state, variants, onEnter, autoFocus }: {
  focusKey: string; label: string; title: string; meta: string; state: RowState; variants: number;
  onEnter: () => void; autoFocus?: boolean;
}) {
  const { ref } = useFocusItem<HTMLDivElement>({ index: 0, focusKey, onEnter, autoFocus });
  return (
    <div ref={ref} onClick={onEnter} className="tv-row-item flex-1 min-w-0 flex items-center gap-5 h-[84px] rounded-lg px-5 mb-[10px]">
      <span className="tv-dim w-[76px] shrink-0 text-lead font-semibold tabular-nums text-tv-text2">{label}</span>
      <div className="flex-1 min-w-0">
        <p className="text-body font-semibold truncate">{title}</p>
        <p className="tv-dim text-caption text-tv-text2 truncate">
          {meta}{variants > 1 ? ` · ${variants} versiones` : ''}
        </p>
      </div>
      <div className="shrink-0 w-[190px] flex justify-end">
        {state.status === 'ready' && (
          <span className="tv-pill inline-flex items-center gap-2 px-4 h-[40px] rounded-full bg-tv-ok/20 text-tv-ok text-caption font-bold">
            <span className="w-5 h-5"><IconPlay /></span>Reproducir
          </span>
        )}
        {state.status === 'busy' && (
          <span className="w-full">
            <span className="tv-dim block text-caption text-right mb-1">{stateLabel(state.ds)}</span>
            <span className="tv-progress-track block h-[6px] rounded-full bg-white/20 overflow-hidden">
              <span className="block h-full bg-tv-red" style={{ width: `${state.ds.progress}%` }} />
            </span>
          </span>
        )}
        {state.status === 'idle' && (
          <span className="tv-pill inline-flex items-center gap-2 px-4 h-[40px] rounded-full bg-white/10 text-caption font-bold">
            <span className="w-5 h-5"><IconDownload /></span>Descargar
          </span>
        )}
      </div>
    </div>
  );
}

const LIST_VIEW = 720;   // alto visible de la lista

/**
 * Ficha a pantalla completa de una pelicula o serie.
 *
 * Izquierda: fondo, titulo, datos y sinopsis, y el boton Reproducir si hay
 * algo en disco. Derecha: temporadas como chips y la lista de episodios (o
 * las versiones de la pelicula). Cada fila hace lo que toca con OK:
 * reproducir si esta en disco, descargar si no, o gestionar la descarga si
 * esta en curso. Atras cierra y el foco vuelve a la tarjeta de origen.
 */
export default function TitleDetail({ input, onClose }: Props) {
  const { meta, kind } = input;
  const { downloadStates, download, cancelBatch, pauseBatch, rutaDe, rutaEpisodio, recargar } = useDownloadsCtx();
  const [playing, setPlaying] = useState<{ path: string; title: string; subtitle?: string } | null>(null);
  const [dialog, setDialog] = useState<{
    title: string; text?: string; actions: { label: string; onSelect: () => void; primary?: boolean }[];
    /** Version cuyo progreso se enseña en vivo; si deja de estar en curso, el cuadro se cierra. */
    live?: Version;
  } | null>(null);
  const [episodeNames, setEpisodeNames] = useState<Map<string, string>>(new Map());
  const [season, setSeason] = useState<number | null | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);
  const listOffset = useRef(0);

  useBackHandler(() => { if (!playing && !dialog) { onClose(); return true; } return false; }, true);

  // Versiones de los archivos indexados + los que ya estan en disco (biblioteca).
  const versions = useMemo(() => {
    const vs = groupVersions(input.files);
    const resolved = new Set(vs.map((v) => rutaEpisodio(v.fileName, v.season, v.episode) || rutaDe(v.fileName)).filter(Boolean));
    for (const l of input.local || []) {
      // Ya representado por su version del catalogo (mismo nombre o misma ruta en disco).
      if (vs.some((v) => v.fileName === l.name) || resolved.has(l.path)) continue;
      const m = l.name.match(/(\d{1,2})x(\d{2,3})|[sS](\d{1,2})[eE](\d{1,3})/);
      vs.push({
        key: `local:${l.path}`, fileName: l.name, baseName: l.name.replace(/\.[^.]+$/, ''), quality: 'En disco',
        sizeBytes: 0, sizeStr: l.size, parts: 1, messageId: 0, channelName: 'Biblioteca', downloaded: true, path: l.path,
        season: m ? parseInt(m[1] || m[3]) : undefined, episode: m ? parseInt(m[2] || m[4]) : undefined,
      });
    }
    return vs;
  }, [input.files, input.local, rutaDe, rutaEpisodio]);

  const episodes = useMemo(() => (kind === 'series' ? groupEpisodes(versions) : []), [versions, kind]);
  const seasons = useMemo(() => {
    const s = new Set<number | null>();
    episodes.forEach((e) => s.add(e.season));
    return [...s].sort((a, b) => (a ?? 999) - (b ?? 999));
  }, [episodes]);
  const activeSeason = season === undefined ? seasons[0] : season;
  const shown = useMemo(() => (kind === 'series' ? episodes.filter((e) => e.season === activeSeason) : []), [episodes, activeSeason, kind]);

  // Nombres de episodio de TMDB por temporada.
  useEffect(() => {
    if (kind !== 'series' || !input.tmdbId || activeSeason === null || activeSeason === undefined) return;
    if (episodeNames.has(`${activeSeason}:_`)) return;
    (async () => {
      try {
        const res = await apiFetch(`/tmdb/season?tmdb_id=${input.tmdbId}&season=${activeSeason}`);
        const data = await res.json();
        setEpisodeNames((prev) => {
          const next = new Map(prev);
          next.set(`${activeSeason}:_`, '');
          for (const ep of data.episodes || []) if (ep.name) next.set(`${activeSeason}:${ep.episode_number}`, ep.name);
          return next;
        });
      } catch { /* sin nombres */ }
    })();
  }, [kind, input.tmdbId, activeSeason]); // eslint-disable-line react-hooks/exhaustive-deps

  const pathOf = useCallback((v: Version): string | undefined => {
    if (v.path) return v.path;
    return rutaEpisodio(v.fileName, v.season, v.episode) || rutaDe(v.fileName);
  }, [rutaDe, rutaEpisodio]);

  const stateOf = useCallback((v: Version): RowState => {
    const p = pathOf(v);
    if (p) return { status: 'ready', path: p };
    const ds = downloadStates.get(v.messageId);
    if (ds && (ds.status === 'downloading' || ds.status === 'extracting' || ds.status === 'converting')) return { status: 'busy', ds };
    return { status: 'idle' };
  }, [pathOf, downloadStates]);

  const play = useCallback((path: string, subtitle?: string) => {
    setPlaying({ path, title: meta.title, subtitle });
  }, [meta.title]);

  const act = useCallback((v: Version, subtitle?: string) => {
    const st = stateOf(v);
    if (st.status === 'ready') { play(st.path, subtitle); return; }
    if (st.status === 'busy') {
      const ds = st.ds;
      setDialog({
        title: 'Descarga en curso',
        live: v,
        actions: [
          { label: 'Seguir descargando', onSelect: () => setDialog(null), primary: true },
          { label: 'Pausar', onSelect: () => { pauseBatch(ds.batchId); setDialog(null); toast('Descarga pausada'); } },
          { label: 'Cancelar descarga', onSelect: () => { cancelBatch(ds.batchId); setDialog(null); toast('Descarga cancelada'); } },
        ],
      });
      return;
    }
    download(v.messageId, v.channelId).then((err) => {
      if (err) toast(err, 'error', 5000);
      else toast(`Descargando ${v.baseName}${v.parts > 1 ? ` (${v.parts} partes)` : ''}`);
    });
  }, [stateOf, play, download, pauseBatch, cancelBatch]);

  const askDelete = useCallback((path: string, label: string) => {
    setDialog({
      title: '¿Borrar del servidor?',
      text: `${label} se eliminará del disco. Podrás volver a descargarlo desde el catálogo.`,
      actions: [
        { label: 'Cancelar', onSelect: () => setDialog(null), primary: true },
        { label: 'Borrar', onSelect: async () => {
          setDialog(null);
          try {
            const res = await apiFetch('/files', { method: 'DELETE', body: JSON.stringify({ path }) });
            const data = await res.json();
            if (data.error) toast(data.error, 'error', 5000);
            else { toast('Archivo borrado', 'ok'); await recargar(); }
          } catch { toast('No se ha podido borrar', 'error', 5000); }
        } },
      ],
    });
  }, [recargar]);

  const onEpisode = useCallback((e: Episode) => {
    const subtitle = `${episodeLabel(e)} · ${episodeNames.get(`${e.season}:${e.episode}`) || ''}`.replace(/ · $/, '');
    if (e.variants.length === 1) { act(e.variants[0], subtitle); return; }
    // Si alguna ya esta en disco, esa manda; si no, se elige version.
    const ready = e.variants.find((v) => stateOf(v).status === 'ready');
    if (ready) { act(ready, subtitle); return; }
    setDialog({
      title: `Elige versión · ${episodeLabel(e)}`,
      actions: e.variants.map((v) => ({
        label: `${v.quality} · ${v.sizeStr} · ${v.channelName}`,
        onSelect: () => { setDialog(null); act(v, subtitle); },
      })),
    });
  }, [act, stateOf, episodeNames]);

  // Desplazamiento de la lista: la fila enfocada nunca baja del 60 % del alto visible.
  const onListFocus = useCallback((_i: number, childId: string) => {
    const track = listRef.current;
    const el = getElement(childId);
    if (!track || !el) return;
    let next = listOffset.current;
    const top = el.offsetTop, bottom = top + el.offsetHeight;
    if (top - next < 0) next = top;
    else if (bottom - next > LIST_VIEW * 0.6) next = bottom - LIST_VIEW * 0.6;
    next = Math.max(0, next);
    if (next !== listOffset.current) {
      listOffset.current = next;
      track.style.transform = `translate3d(0, ${-next}px, 0)`;
    }
  }, []);

  useEffect(() => {
    // Al cambiar de temporada la lista vuelve arriba.
    listOffset.current = 0;
    if (listRef.current) listRef.current.style.transform = 'translate3d(0,0,0)';
  }, [activeSeason]);

  // Boton Reproducir de la izquierda: lo que este en disco (y a medias, primero).
  const playable = useMemo(() => {
    const ready = versions.map((v) => ({ v, p: pathOf(v) })).filter((x) => !!x.p) as { v: Version; p: string }[];
    if (!ready.length) return null;
    const resumed = ready.find((x) => resumePoint(x.p) > 0);
    const pick = resumed || ready[0];
    const sub = pick.v.episode !== undefined ? `${pick.v.season ?? ''}x${String(pick.v.episode).padStart(2, '0')}` : undefined;
    return { path: pick.p, subtitle: sub, resume: !!resumed };
  }, [versions, pathOf]);

  const readyCount = versions.filter((v) => !!pathOf(v)).length;

  // El foco inicial va a lo util: Reproducir si hay algo en disco, y si no el
  // primer episodio o version. Sin esto caia en el chip de temporada.
  const firstRowKey = kind === 'series'
    ? (shown[0] ? `ep-${shown[0].season}-${shown[0].episode}` : null)
    : (versions[0] ? `ver-${versions[0].key}` : null);
  const initialDone = useRef(false);
  useEffect(() => {
    if (initialDone.current) return;
    const target = playable ? 'detail-play' : firstRowKey;
    if (!target) return;
    initialDone.current = true;
    const raf = requestAnimationFrame(() => setFocus(target));
    return () => cancelAnimationFrame(raf);
  }, [playable, firstRowKey]);
  const bg = bigBackdrop(meta.backdrop) || meta.poster;
  const infoParts: string[] = [];
  if (meta.year) infoParts.push(String(meta.year));
  if (meta.genres?.length) infoParts.push(meta.genres.slice(0, 3).join(' · '));
  if (kind === 'series') infoParts.push(`${episodes.length} episodios`);
  else infoParts.push(`${versions.length} ${versions.length === 1 ? 'versión' : 'versiones'}`);

  return (
    <Overlay>
    <div className="fixed inset-0 z-[60] bg-tv-bg overflow-hidden">
      {bg && <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${bg})`, opacity: 0.55 }} />}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, #141414 0%, rgba(20,20,20,0.96) 36%, rgba(20,20,20,0.55) 60%, rgba(20,20,20,0.35) 100%)' }} />
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(20,20,20,0.2) 0%, rgba(20,20,20,0) 30%, #141414 100%)' }} />

      <FocusScope trap orientation="horizontal" as="none">
        {/* columna izquierda */}
        <FocusScope index={0} orientation="vertical" className="absolute left-[96px] top-[96px] w-[700px] z-10">
          <p className="text-caption text-tv-text3 font-semibold tracking-wide mb-3">{kind === 'series' ? 'SERIE' : 'PELÍCULA'}</p>
          <h1 className="text-hero font-bold tracking-tight line-clamp-2">{meta.title}</h1>
          <div className="mt-4 flex items-center gap-4 text-lead text-tv-text2">
            {meta.rating ? <span className="inline-flex items-center gap-2 text-white"><span className="w-6 h-6 text-tv-warn"><IconStar /></span>{meta.rating.toFixed(1)}</span> : null}
            {infoParts.map((p, i) => (
              <span key={i} className="inline-flex items-center gap-4">
                {(i > 0 || meta.rating) ? <span className="w-[6px] h-[6px] rounded-full bg-tv-text3" /> : null}{p}
              </span>
            ))}
          </div>
          {meta.overview && <p className="mt-6 text-body text-tv-text2 leading-relaxed line-clamp-4">{meta.overview}</p>}
          <div className="mt-8 flex items-center gap-4">
            {playable && (
              <TvButton index={0} focusKey="detail-play" primary icon={<IconPlay />} onClick={() => play(playable.path, playable.subtitle)}>
                {playable.resume ? 'Continuar viendo' : 'Reproducir'}
              </TvButton>
            )}
            {readyCount > 0 && (
              <span className="inline-flex items-center gap-2 text-caption text-tv-ok font-semibold">
                <span className="w-5 h-5"><IconCheck /></span>{readyCount} en disco
              </span>
            )}
          </div>
          {versions.length === 0 && (
            <p className="mt-10 text-body text-tv-text3">No hay archivos indexados para este título.</p>
          )}
        </FocusScope>

        {/* columna derecha */}
        <FocusScope index={1} orientation="vertical" className="absolute left-[880px] right-[96px] top-[96px] bottom-0 z-10">
          {kind === 'series' && seasons.length > 1 && (
            <FocusScope index={0} orientation="horizontal" className="flex gap-2 mb-6 overflow-hidden">
              {seasons.map((s, i) => (
                <Chip key={String(s)} index={i} label={seasonLabel(s)} selected={s === activeSeason} onSelect={() => setSeason(s)} />
              ))}
            </FocusScope>
          )}
          {kind === 'series' && seasons.length === 1 && (
            <p className="text-row font-semibold mb-6">{seasonLabel(seasons[0])}</p>
          )}
          {kind === 'movie' && versions.length > 0 && (
            <p className="text-row font-semibold mb-6">Versiones disponibles</p>
          )}

          <div className="relative overflow-hidden" style={{ height: LIST_VIEW }}>
            <FocusScope index={1} orientation="vertical" onChildFocus={onListFocus} as="none">
              <div ref={listRef} className="tv-list-track" style={{ transform: 'translate3d(0,0,0)' }}>
                {kind === 'series' && shown.map((e, i) => {
                  const best = e.variants.find((v) => stateOf(v).status !== 'idle') || e.variants[0];
                  const st = stateOf(best);
                  const name = episodeNames.get(`${e.season}:${e.episode}`) || best.baseName;
                  return (
                    <ListRow key={`${e.season}:${e.episode}`} index={i} focusKey={`ep-${e.season}-${e.episode}`}
                      label={episodeLabel(e)} title={name}
                      meta={`${best.quality} · ${best.sizeStr}${best.channelName ? ` · ${best.channelName}` : ''}`}
                      state={st} variants={e.variants.length} onEnter={() => onEpisode(e)} autoFocus={i === 0 && !playable}
                      onDelete={st.status === 'ready' ? () => askDelete(st.path, `${episodeLabel(e)} · ${name}`) : undefined} />
                  );
                })}
                {kind === 'movie' && versions.map((v, i) => (
                  <ListRow key={v.key} index={i} focusKey={`ver-${v.key}`} label={v.quality.split(' · ')[0]}
                    title={v.baseName}
                    meta={`${v.quality} · ${v.sizeStr}${v.parts > 1 ? ` · ${v.parts} partes` : ''}${v.channelName ? ` · ${v.channelName}` : ''}`}
                    state={stateOf(v)} variants={1} onEnter={() => act(v)} autoFocus={i === 0 && !playable}
                    onDelete={(() => { const st = stateOf(v); return st.status === 'ready' ? () => askDelete(st.path, v.baseName) : undefined; })()} />
                ))}
              </div>
            </FocusScope>
            <div className="absolute left-0 right-0 bottom-0 h-[80px] pointer-events-none" style={{ background: 'linear-gradient(180deg, rgba(20,20,20,0), #141414)' }} />
          </div>
          <p className="mt-3 text-caption text-tv-text3">OK: reproducir si está en disco, descargar si no · Atrás: volver</p>
        </FocusScope>
      </FocusScope>

      {dialog && (() => {
        // El porcentaje del cuadro se lee en cada render, no al abrirlo.
        let text = dialog.text;
        if (dialog.live) {
          const st = stateOf(dialog.live);
          if (st.status !== 'busy') { setTimeout(() => setDialog(null), 0); return null; }
          text = `${dialog.live.baseName} · ${stateLabel(st.ds)}${st.ds.downloadedStr && st.ds.totalStr ? ` · ${st.ds.downloadedStr} / ${st.ds.totalStr}` : ''}${st.ds.speed ? ` · ${st.ds.speed}` : ''}`;
        }
        return <Dialog title={dialog.title} text={text} actions={dialog.actions} onClose={() => setDialog(null)} />;
      })()}

      {playing && (
        <Player src={streamUrl(playing.path)} path={playing.path} title={playing.title} subtitle={playing.subtitle}
          poster={meta.poster} backdrop={meta.backdrop} onClose={() => setPlaying(null)} />
      )}
    </div>
    </Overlay>
  );
}
