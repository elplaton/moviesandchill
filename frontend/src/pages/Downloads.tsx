import { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import MovieRow from '../components/MovieRow';
import MovieCard from '../components/MovieCard';
import PlayDetail from '../components/PlayDetail';
import SeriesDetail from '../components/SeriesDetail';
import DownloadBar from '../components/DownloadBar';
import { apiFetch, getAccessToken } from '../services/api';
import { fetchMetadataBatch } from '../services/tmdb';
import { useDownloads } from '../hooks/useDownloads';
import { useLibrary } from '../contexts/LibraryContext';
import { useAuth } from '../contexts/AuthContext';
import { cleanTitle } from '../utils/text';
import type { FileItem, TMDBMetadata } from '../types';

interface Item extends FileItem { owner?: string; can_delete?: boolean }

const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GB`;
const epOf = (n: string) => /(\d{1,2})x(\d{2,3})|[sS]\d{1,2}[eE]\d{1,3}/.test(n);
const seriesName = (f: Item) => {
  const parts = f.path.split('/'); const folder = parts[parts.length - 2] || '';
  return cleanTitle(folder).replace(/^S\d{1,2}\s*[-–]\s*|\s*S\d{1,2}$/gi, '').trim() || cleanTitle(f.name);
};

/**
 * Descargas: lo que está bajando, lo pausado y lo que hay en el servidor
 * (de todas las cuentas). Se puede ver todo; borrar, solo lo propio (o todo
 * si eres admin). Arriba, la cuota de la cuenta.
 */
export default function Downloads() {
  const { username, isAdmin, usedBytes, quotaBytes, refreshMe } = useAuth();
  const { reload: reloadIndex } = useLibrary();
  const { batches, pausedBatches, downloadStates, loadPaused, loadStatus, cancelBatch, pauseBatch, resumeBatch } = useDownloads();
  const [files, setFiles] = useState<Item[]>([]);
  const [metas, setMetas] = useState<Map<string, TMDBMetadata>>(new Map());
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [playing, setPlaying] = useState<Item | null>(null);
  const [series, setSeries] = useState<{ item: Item; meta: TMDBMetadata } | null>(null);
  const [filter, setFilter] = useState<'all' | 'mine'>('all');

  const load = useCallback(async () => {
    try {
      const d = await (await apiFetch('/files')).json();
      const raw: Item[] = (d.files || []).filter((f: Item) => !f.is_dir || f.is_series);
      // Un episodio suelto en una carpeta de temporada se agrupa como serie.
      const out: Item[] = []; const byFolder = new Map<string, Item>();
      for (const f of raw) {
        if (f.is_series || !epOf(f.name)) { out.push(f); continue; }
        const key = seriesName(f).toLowerCase();
        let g = byFolder.get(key);
        if (!g) { g = { ...f, name: seriesName(f), is_dir: true, is_series: true, clean_name: seriesName(f), episodes: [], path: f.path.split('/').slice(0, -1).join('/') }; byFolder.set(key, g); out.push(g); }
        g.episodes!.push({ name: f.name, size: f.size, path: f.path });
      }
      setFiles(out);
      const names = [...new Set(out.map(f => f.clean_name || cleanTitle(f.name)).filter(Boolean))];
      if (names.length) setMetas(await fetchMetadataBatch(names));
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); loadStatus(); loadPaused(); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  // Al terminar una descarga aparece en la lista sin recargar la pagina.
  useEffect(() => {
    const done = batches.filter(b => b.status === 'done').length;
    if (done) { load(); reloadIndex(); refreshMe(); }
  }, [batches]); // eslint-disable-line react-hooks/exhaustive-deps

  const metaFor = (f: Item): TMDBMetadata => metas.get(f.clean_name || cleanTitle(f.name)) || { title: f.clean_name || cleanTitle(f.name) };
  const visible = files.filter(f => filter === 'all' || f.owner === username);
  const seriesItems = visible.filter(f => f.is_series);
  const movieItems = visible.filter(f => !f.is_series);
  const active = batches.filter(b => ['downloading', 'extracting', 'converting'].includes(b.status));
  const streamUrl = (path: string) => `/api/stream?path=${encodeURIComponent(path)}&token=${encodeURIComponent(getAccessToken() || '')}`;
  const pct = quotaBytes ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100)) : 0;

  const remove = async (path: string, label: string) => {
    if (!confirm(`¿Borrar "${label}" del servidor?`)) return;
    const d = await (await apiFetch('/files', { method: 'DELETE', body: JSON.stringify({ path }) })).json();
    if (d.error) { setNotice(d.error); setTimeout(() => setNotice(''), 4000); return; }
    setPlaying(null); setSeries(null);
    await load(); reloadIndex(); refreshMe();
  };

  return (
    <Layout>
      <div className="pt-20 pb-4 px-6 md:px-14 flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="text-white text-4xl md:text-5xl font-bold mb-2 tracking-tight animate-fade-in">Descargas</h1>
          <p className="text-gray-400 text-base md:text-lg animate-fade-in">
            {loading ? 'Cargando…' : `${files.length} ${files.length === 1 ? 'título' : 'títulos'} en el servidor`}
          </p>
        </div>
        <div className="w-72">
          <div className="flex justify-between text-xs text-gray-400 mb-1.5">
            <span>{quotaBytes != null ? `${gb(usedBytes)} de ${gb(quotaBytes)}` : `${gb(usedBytes)} · sin límite`}</span>
            {quotaBytes != null && <span>{pct} %</span>}
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className={`h-full rounded-full ${pct >= 90 ? 'bg-netflix-red' : 'bg-green-500'}`} style={{ width: `${quotaBytes ? pct : 5}%` }} />
          </div>
          <div className="mt-3 flex rounded-full bg-white/10 p-0.5 text-xs w-max">
            <button onClick={() => setFilter('all')} className={`px-3 py-1 rounded-full transition-all ${filter === 'all' ? 'bg-white text-black' : 'text-gray-300'}`}>Todo</button>
            <button onClick={() => setFilter('mine')} className={`px-3 py-1 rounded-full transition-all ${filter === 'mine' ? 'bg-white text-black' : 'text-gray-300'}`}>Lo mío</button>
          </div>
        </div>
      </div>

      {notice && <div className="fixed top-24 right-6 z-[60] bg-netflix-dark border border-netflix-red/50 text-white px-5 py-3 rounded-2xl shadow-2xl text-sm max-w-md animate-slide-up">{notice}</div>}

      {active.length > 0 && (
        <MovieRow title="Descargando">
          {active.map(b => {
            const name = cleanTitle(b.folder_name).replace(/^S\d{1,2}\s*[-–]\s*/i, '');
            const meta = metas.get(name);
            const ds = { messageId: 0, batchId: b.batch_id, progress: b.progress, status: (b.status === 'downloading' ? 'downloading' : b.status) as any };
            const mine = isAdmin || !b.owner || b.owner === username;
            return (
              <MovieCard key={b.batch_id} name={name} posterUrl={meta?.poster} year={meta?.year} rating={meta?.rating}
                subtitle={`${b.progress}% · ${b.downloaded_parts}/${b.total_parts} partes${b.owner && b.owner !== username ? ` · ${b.owner}` : ''}`}
                downloadState={ds} onCancelDownload={mine ? () => cancelBatch(b.batch_id) : undefined} actions="click" />
            );
          })}
        </MovieRow>
      )}

      {pausedBatches.length > 0 && (
        <div className="px-6 md:px-14 mb-10">
          <h2 className="text-white text-lg font-medium mb-3">Pausadas</h2>
          <div className="flex gap-3 flex-wrap">
            {pausedBatches.map((b: any) => (
              <div key={b.batch_id} className="bg-white/5 border border-white/10 rounded-xl px-5 py-4">
                <p className="text-white text-sm font-medium">{cleanTitle(b.folder_name)}</p>
                <p className="text-gray-500 text-xs mt-1 mb-3">{b.total_parts} partes · {b.total_size_str}</p>
                <button onClick={() => resumeBatch(b.batch_id)} className="bg-netflix-red hover:bg-netflix-red-hover text-white text-xs px-4 py-2 rounded-lg transition-colors font-medium">Reanudar</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {seriesItems.length > 0 && (
        <MovieRow title="Series">
          {seriesItems.map(f => { const m = metaFor(f); return (
            <MovieCard key={f.path} name={m.title} posterUrl={m.poster} year={m.year} rating={m.rating}
              subtitle={`${f.episodes?.length || 0} ${(f.episodes?.length || 0) === 1 ? 'episodio' : 'episodios'} · ${f.owner || 'admin'}`}
              onClick={() => setSeries({ item: f, meta: m })} hoverLabel="Ver episodios" actions="click" />
          ); })}
        </MovieRow>
      )}

      {movieItems.length > 0 && (
        <MovieRow title="Películas">
          {movieItems.map(f => { const m = metaFor(f); return (
            <MovieCard key={f.path} name={m.title} posterUrl={m.poster} year={m.year} rating={m.rating}
              subtitle={`${f.size} · ${f.owner || 'admin'}`} downloaded
              onClick={() => setPlaying(f)} hoverLabel="Reproducir" actions="click" />
          ); })}
        </MovieRow>
      )}

      {!loading && files.length === 0 && active.length === 0 && (
        <div className="px-6 md:px-14 py-16 text-center">
          <p className="text-gray-500 text-lg mb-2">Todavía no hay nada descargado</p>
          <p className="text-gray-600 text-sm">Busca una película o serie y pulsa Descargar</p>
        </div>
      )}

      {playing && (
        <PlayDetail name={playing.name} size={playing.size} path={playing.path} metadata={metaFor(playing)} streamUrl={streamUrl}
          onClose={() => setPlaying(null)} onDelete={playing.can_delete ? () => remove(playing.path, metaFor(playing).title) : undefined} />
      )}
      {series && (
        <SeriesDetail series={series.item} metadata={series.meta} streamUrl={streamUrl} onClose={() => setSeries(null)}
          downloadStates={downloadStates} tmdbId={(series.meta as any).tmdb_id} />
      )}

      <DownloadBar batches={batches} onPause={pauseBatch} onCancel={cancelBatch} downloadStates={downloadStates} />
    </Layout>
  );
}
