import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch, streamUrl } from '../services/api';
import { fetchMetadataBatch } from '../services/tmdb';
import { fetchMediaFiles } from '../services/media';
import { useDownloadsCtx } from '../contexts/DownloadsContext';
import { continueWatching, type Watched } from '../tv/progress';
import { toast } from '../tv/toast';
import { cleanTitle } from '../utils/text';
import Screen from '../components/Screen';
import Row from '../components/Row';
import PosterCard from '../components/PosterCard';
import Dialog from '../components/Dialog';
import Player from '../components/Player';
import TitleDetail, { type DetailInput } from '../components/TitleDetail';
import type { Batch, Featured, FileItem, SearchResult, TMDBMetadata } from '../types';

interface Local { file: FileItem; f: Featured; meta: TMDBMetadata }

/** Nombre de serie a partir de un episodio ("1x01 - The Office (US).mkv") o de su carpeta ("S1 - The Office (US)"). */
function seriesName(fileName: string, folder: string): string {
  const fromFolder = cleanTitle(folder).replace(/^S\d{1,2}\s*[-–]\s*|\s*S\d{1,2}$/gi, '').trim();
  return fromFolder || cleanTitle(fileName);
}

/**
 * Descargas: lo que hay en disco (series y peliculas), lo que esta bajando y
 * lo que se dejo a medias de ver. Todo se reproduce desde aqui.
 */
export default function Library() {
  const { batches, pausedBatches, downloadStates, pauseBatch, cancelBatch, resumeBatch, loadStatus, loadPaused, total } = useDownloadsCtx();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [metas, setMetas] = useState<Map<string, TMDBMetadata>>(new Map());
  const [loading, setLoading] = useState(true);
  const [focusRow, setFocusRow] = useState(0);
  const [playing, setPlaying] = useState<{ path: string; title: string; subtitle?: string; poster?: string; backdrop?: string } | null>(null);
  const [detail, setDetail] = useState<DetailInput | null>(null);
  const [batchDialog, setBatchDialog] = useState<Batch | null>(null);
  const [resume, setResume] = useState<Watched[]>(() => continueWatching());

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/files');
      const data = await res.json();
      const items: FileItem[] = (data.files || []).filter((f: FileItem) => !f.is_dir || f.is_series);
      setFiles(items);
      const names = [...new Set(items.flatMap((f) => {
        const parts = f.path.split('/');
        const folder = parts[parts.length - 2] || '';
        return [f.clean_name || cleanTitle(f.name), seriesName(f.name, folder)];
      }).filter(Boolean))];
      if (names.length) setMetas(await fetchMetadataBatch(names));
    } catch {
      toast('No se ha podido leer la biblioteca', 'error', 5000);
    } finally {
      setLoading(false);
    }
  }, []);

  // `total` cambia cuando el indice de disco se recarga (descarga terminada o archivo borrado).
  useEffect(() => { load(); loadStatus(); loadPaused(); }, [load, total]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lo que esta bajando tambien esta ya en disco (a medias): se excluye de la
  // biblioteca por el nombre de su carpeta. Y un episodio suelto en una
  // carpeta de temporada se agrupa como serie, no como pelicula.
  const activeFolders = useMemo(() => new Set(batches
    .filter((b) => ['downloading', 'extracting', 'converting'].includes(b.status))
    .map((b) => b.folder_name.toLowerCase())), [batches]);

  const grouped = useMemo<FileItem[]>(() => {
    const out: FileItem[] = [];
    const byFolder = new Map<string, FileItem>();
    for (const f of files) {
      const parts = f.path.split('/');
      const folder = f.is_series ? f.name : (parts[parts.length - 2] || '');
      if (activeFolders.has(folder.toLowerCase())) continue;
      if (f.is_series) { out.push(f); continue; }
      const isEpisode = /(\d{1,2})x(\d{2,3})|[sS]\d{1,2}[eE]\d{1,3}/.test(f.name);
      if (!isEpisode) { out.push(f); continue; }
      const key = folder.toLowerCase().replace(/^s\d{1,2}\s*[-–]\s*|\s*s\d{1,2}$/g, '').trim();
      let g = byFolder.get(key);
      if (!g) {
        g = { name: folder, is_dir: true, size: '', path: parts.slice(0, -1).join('/'), is_series: true,
          clean_name: seriesName(f.name, folder), episodes: [] };
        byFolder.set(key, g);
        out.push(g);
      }
      g.episodes!.push({ name: f.name, size: f.size, path: f.path });
    }
    return out;
  }, [files, activeFolders]);

  const locals = useMemo<Local[]>(() => grouped.map((file) => {
    const key = file.clean_name || cleanTitle(file.name);
    const meta = metas.get(key) || { title: key };
    const isSeries = !!file.is_series;
    return {
      file, meta,
      f: {
        key: `lib-${file.path}`, kind: isSeries ? 'series' : 'movie',
        title: meta.title || key, poster: meta.poster, backdrop: meta.backdrop, year: meta.year, rating: meta.rating,
        overview: meta.overview, genres: meta.genres,
        subtitle: isSeries ? `${file.episodes?.length || 0} ${(file.episodes?.length || 0) === 1 ? 'episodio' : 'episodios'} en disco` : file.size,
      },
    };
  }), [grouped, metas]);

  const seriesLocal = locals.filter((l) => l.file.is_series);
  const moviesLocal = locals.filter((l) => !l.file.is_series);

  const active = batches.filter((b) => ['downloading', 'extracting', 'converting'].includes(b.status));
  const activeCards = active.map((b) => {
    const name = seriesName(b.folder_name, b.folder_name);
    const meta = metas.get(name);
    const label = b.status === 'extracting' ? 'Extrayendo' : b.status === 'converting' ? 'Convirtiendo' : `${b.downloaded_parts}/${b.total_parts} partes`;
    return { b, label, f: { key: `dl-${b.batch_id}`, kind: 'movie' as const, title: name, poster: meta?.poster, backdrop: meta?.backdrop, subtitle: `${b.progress} % · ${label}` } };
  });

  // Desde disco se abre la misma ficha que desde el catalogo: todos los
  // episodios o versiones, con Reproducir en los que ya estan bajados y
  // Borrar al lado. Si el titulo no esta en TMDB, solo lo que hay en disco.
  const open = useCallback(async (l: Local) => {
    const kind = l.file.is_series ? 'series' : 'movie';
    const local = l.file.is_series
      ? (l.file.episodes || []).map((e) => ({ name: e.name, path: e.path, size: e.size }))
      : [{ name: l.file.name, path: l.file.path, size: l.file.size }];
    let files: SearchResult[] = [];
    if (l.meta.tmdb_id) {
      try { files = (await fetchMediaFiles(l.meta.tmdb_id, kind)).results; } catch { /* solo disco */ }
    }
    setDetail({ kind, tmdbId: l.meta.tmdb_id, meta: l.f, files, local });
  }, []);

  const rowsOrder: string[] = [];
  if (resume.length) rowsOrder.push('resume');
  if (activeCards.length) rowsOrder.push('active');
  if (pausedBatches.length) rowsOrder.push('paused');
  if (seriesLocal.length) rowsOrder.push('series');
  if (moviesLocal.length) rowsOrder.push('movies');
  const idx = (k: string) => rowsOrder.indexOf(k);
  const mounted = (k: string) => Math.abs(idx(k) - focusRow) <= 2;
  const empty = !loading && rowsOrder.length === 0;
  const fallback = locals[0]?.f || activeCards[0]?.f || null;

  return (
    <Screen hero heading="Descargas" heroFallback={fallback} ready={!loading && rowsOrder.length > 0} onRowFocus={setFocusRow}>
      {resume.length > 0 && (
        <Row index={idx('resume')} title="Continuar viendo">
          {resume.map((w, i) => (
            <PosterCard key={w.path} index={i} autoFocus={i === 0}
              item={{ key: `cw-${w.path}`, kind: 'file', title: w.title, poster: w.poster, backdrop: w.backdrop, subtitle: w.subtitle, progress: w.position / w.duration }}
              onSelect={() => setPlaying({ path: w.path, title: w.title, subtitle: w.subtitle, poster: w.poster, backdrop: w.backdrop })} />
          ))}
        </Row>
      )}
      {activeCards.length > 0 && (
        <Row index={idx('active')} title="Descargando">
          {activeCards.map(({ b, f, label }, i) => (
            <PosterCard key={f.key} index={i} item={f} downloading={b.progress} busyLabel={label} onSelect={() => setBatchDialog(b)} />
          ))}
        </Row>
      )}
      {pausedBatches.length > 0 && (
        <Row index={idx('paused')} title="Pausadas">
          {pausedBatches.map((b: any, i: number) => (
            <PosterCard key={b.batch_id} index={i}
              item={{ key: `paused-${b.batch_id}`, kind: 'movie', title: cleanTitle(b.folder_name), poster: metas.get(cleanTitle(b.folder_name))?.poster, subtitle: `Pausada · ${b.total_parts} partes · ${b.total_size_str}` }}
              onSelect={() => { resumeBatch(b.batch_id); toast('Reanudando descarga'); }} />
          ))}
        </Row>
      )}
      {seriesLocal.length > 0 && (
        <Row index={idx('series')} title="Series">
          {mounted('series') ? seriesLocal.map((l, i) => (
            <PosterCard key={l.f.key} index={i} item={l.f} downloaded autoFocus={rowsOrder[0] === 'series' && i === 0} onSelect={() => open(l)} />
          )) : null}
        </Row>
      )}
      {moviesLocal.length > 0 && (
        <Row index={idx('movies')} title="Películas">
          {mounted('movies') ? moviesLocal.map((l, i) => (
            <PosterCard key={l.f.key} index={i} item={l.f} downloaded autoFocus={rowsOrder[0] === 'movies' && i === 0} onSelect={() => open(l)} />
          )) : null}
        </Row>
      )}

      {empty && (
        <div style={{ paddingLeft: 'var(--content-x)' }}>
          <p className="text-lead text-tv-text2">Todavía no has descargado nada.</p>
          <p className="text-body text-tv-text3 mt-2">Entra en una película o serie y pulsa OK sobre un episodio para bajarlo.</p>
        </div>
      )}

      {batchDialog && (
        <Dialog title={cleanTitle(batchDialog.folder_name)}
          text={`${batchDialog.progress} % · ${batchDialog.downloaded_parts}/${batchDialog.total_parts} partes · ${batchDialog.total_size_str}`}
          onClose={() => setBatchDialog(null)}
          actions={[
            { label: 'Seguir', onSelect: () => setBatchDialog(null), primary: true },
            { label: 'Pausar', onSelect: () => { pauseBatch(batchDialog.batch_id); setBatchDialog(null); } },
            { label: 'Cancelar descarga', onSelect: () => { cancelBatch(batchDialog.batch_id); setBatchDialog(null); } },
          ]} />
      )}
      {detail && <TitleDetail input={detail} onClose={() => setDetail(null)} />}
      {playing && (
        <Player src={streamUrl(playing.path)} path={playing.path} title={playing.title} subtitle={playing.subtitle}
          poster={playing.poster} backdrop={playing.backdrop}
          onClose={() => { setPlaying(null); setResume(continueWatching()); }} />
      )}
    </Screen>
  );
}
