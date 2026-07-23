import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../services/api';
import { getAccessToken } from '../services/api';
import { onProgress } from '../services/ws';
import { fetchMetadataBatch } from '../services/tmdb';
import Layout from '../components/Layout';
import MovieRow from '../components/MovieRow';
import MovieCard, { cleanFileName } from '../components/MovieCard';
import DownloadBar from '../components/DownloadBar';
import SeriesDetail from '../components/SeriesDetail';
import MovieDetail from '../components/MovieDetail';
import PlayDetail from '../components/PlayDetail';
import type { SearchResult, Channel, Batch, FileItem, TMDBMetadata, SeriesEpisode, DownloadState } from '../types';

const QUALITY = /\b(1080p|720p|2160p|4k|4K|hdr|hdrip|bdrip|bluray|blu-ray|web-dl|webrip|brrip|dvdrip|hdtv|x264|x265|hevc|h265|aac|ddp|dts|truehd|atmos|h264|av1|multi|dual|castellano|spanish|latino|sub|7z|zip|rar|dv|dovi|dolby vision|hdr10|hdr10\+|remux|dubbed|ac3|eac3)\b/gi;

function cleanTitle(name: string): string {
  let s = name;
  s = s.replace(/\.part\d+/i, '');
  s = s.replace(/\.r\d{2,}$/i, '');
  s = s.replace(/\.\d{3,}$/, '');
  for (const ext of ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts', '.7z', '.zip', '.rar']) {
    if (s.toLowerCase().endsWith(ext)) { s = s.slice(0, -ext.length); break; }
  }
  s = s.replace(/\s+\d{1,2}x\d{2,}.*$/i, '');
  s = s.replace(/\s+[sS]\d{1,2}[eE]?\d{0,2}\b.*$/i, '');
  s = s.replace(/[\[\(].*?[\]\)]/g, '');
  s = s.replace(/\b(19|20)\d{2}\b/g, '');
  s = s.replace(/\s+[sS]\d{1,2}\s*$/i, '');
  s = s.replace(QUALITY, '');
  s = s.replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
  return s || name;
}

function parseTitle(name: string): { seriesName: string; season: number; episode: number; title: string } | null {
  let m = name.match(/^(.+?)\s+(\d{1,2})x(\d{2})\b/i);
  if (m) {
    let s = cleanTitle(m[1].trim());
    return { seriesName: s, season: parseInt(m[2]), episode: parseInt(m[3]), title: name };
  }
  m = name.match(/^(\d{1,2})x(\d{2})\s*[-–]\s*(.+)/i);
  if (m) {
    let s = cleanTitle(m[3].trim());
    return { seriesName: s, season: parseInt(m[1]), episode: parseInt(m[2]), title: name };
  }
  return null;
}

interface SearchGroup {
  seriesName: string;
  season: number;
  episodes: SearchResult[];
  channelId?: number;
}

export default function Dashboard() {
  const { username } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<number[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchGroups, setSearchGroups] = useState<SearchGroup[]>([]);
  const [searchSingles, setSearchSingles] = useState<SearchResult[]>([]);
  const [movieGroups, setMovieGroups] = useState<Map<string, SearchResult[]>>(new Map());
  const [resultsMeta, setResultsMeta] = useState<Map<string, TMDBMetadata>>(new Map());
  const [searching, setSearching] = useState(false);

  const [batches, setBatches] = useState<Batch[]>([]);
  const [pausedBatches, setPausedBatches] = useState<any[]>([]);
  const [downloadingMeta, setDownloadingMeta] = useState<Map<string, TMDBMetadata>>(new Map());
  const lastResultsRef = useRef<{ groups: SearchGroup[]; singles: SearchResult[]; movieGroups: Map<string, SearchResult[]> }>({ groups: [], singles: [], movieGroups: new Map() });

  const [allFiles, setAllFiles] = useState<FileItem[]>([]);
  const [series, setSeries] = useState<FileItem[]>([]);
  const [movies, setMovies] = useState<FileItem[]>([]);
  const [filesMeta, setFilesMeta] = useState<Map<string, TMDBMetadata>>(new Map());
  const [diskFree, setDiskFree] = useState('');

  const [selectedSeries, setSelectedSeries] = useState<{
    series: FileItem; metadata: TMDBMetadata; isSearchResult?: boolean;
  } | null>(null);

  const [selectedMovie, setSelectedMovie] = useState<{
    title: string; metadata: TMDBMetadata; results: SearchResult[];
  } | null>(null);

  const [playDetail, setPlayDetail] = useState<{
    name: string; size: string; path: string; cleanName: string; metadata: TMDBMetadata;
  } | null>(null);

  const [downloadStates, setDownloadStates] = useState<Map<number, DownloadState>>(new Map());
  const downloadStatesRef = useRef(downloadStates);
  downloadStatesRef.current = downloadStates;
  const [viewMode, setViewMode] = useState<'search' | 'library'>('search');

  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error'>('success');

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg); setToastType(type);
    setTimeout(() => setToast(''), 3000);
  };

  const loadChannels = useCallback(async () => {
    try {
      const res = await apiFetch('/channels');
      const data = await res.json();
      setChannels(data.channels || []);
    } catch {}
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const res = await apiFetch('/status');
      const data = await res.json();
      setBatches(data.active_batches || []);
      setDiskFree(data.disk_free || '');
    } catch {}
  }, []);

  const loadPaused = useCallback(async () => {
    try {
      const res = await apiFetch('/resumable');
      const data = await res.json();
      setPausedBatches(data.batches || []);
    } catch {}
  }, []);

  const loadFiles = useCallback(async () => {
    try {
      const res = await apiFetch('/files');
      const data = await res.json();
      const items: FileItem[] = data.files || [];
      setAllFiles(items);
      setSeries(items.filter((f: FileItem) => f.is_series));
      setMovies(items.filter((f: FileItem) => !f.is_series && !f.is_dir));
      const names = items.map((f: FileItem) => f.clean_name || '').filter(Boolean);
      if (names.length > 0) {
        const meta = await fetchMetadataBatch(names);
        setFilesMeta(meta);
      }
    } catch {}
  }, []);

  useEffect(() => {
    const names = batches.map(b => cleanTitle(b.folder_name)).filter(Boolean);
    const uncached = names.filter(n => !downloadingMeta.has(n));
    if (uncached.length > 0) {
      fetchMetadataBatch(uncached).then(meta => {
        setDownloadingMeta(prev => {
          const next = new Map(prev);
          for (const [k, v] of meta) {
            if (v.poster) next.set(k, v);
          }
          return next;
        });
      });
    }
  }, [batches]);

  useEffect(() => {
    loadChannels(); loadStatus(); loadPaused(); loadFiles();
    const unsub = onProgress((data: any) => {
      if (data.type === 'batch_progress' && data.part_message_id) {
        setDownloadStates(prev => {
          const next = new Map(prev);
          const existing = next.get(data.part_message_id);
          if (existing) {
            const now = Date.now();
            const prevBytes = existing._lastBytes || 0;
            const prevTime = existing._lastTime || now;
            let speed = existing.speed || '';
            if (data.downloaded_size_str) {
              const ds = data.downloaded_size_str;
              const ts = data.total_size_str || existing.totalStr || '';
              const elapsed = (now - prevTime) / 1000;
              const sizeMatch = ds.match(/([\d.]+)\s*(GB|MB|KB|B)/i);
              const prevMatch = existing.downloadedStr?.match(/([\d.]+)\s*(GB|MB|KB|B)/i);
              if (sizeMatch && prevMatch && elapsed > 0.5) {
                const toBytes = (v: number, u: string) => {
                  const m: Record<string, number> = { B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 };
                  return v * (m[u.toUpperCase()] || 1);
                };
                const bytesNow = toBytes(parseFloat(sizeMatch[1]), sizeMatch[2]);
                const bytesPrev = toBytes(parseFloat(prevMatch[1]), prevMatch[2]);
                const bytesPerSec = (bytesNow - bytesPrev) / elapsed;
                if (bytesPerSec > 0) {
                  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
                  let v = bytesPerSec;
                  let i = 0;
                  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
                  speed = `${v.toFixed(1)} ${units[i]}`;
                }
              }
              next.set(data.part_message_id, {
                ...existing,
                progress: data.part_progress || data.overall_progress || existing.progress,
                downloadedStr: ds,
                totalStr: ts,
                speed,
                _lastBytes: 0,
                _lastTime: Date.now(),
              });
            } else {
              next.set(data.part_message_id, { ...existing, progress: data.part_progress || data.overall_progress || 0 });
            }
          }
          return next;
        });
      }
      if (data.type === 'batch_update' && data.part_message_id) {
        setDownloadStates(prev => {
          const next = new Map(prev);
          const existing = next.get(data.part_message_id);
          if (existing && data.status === 'done') {
            next.set(data.part_message_id, { ...existing, progress: 100, status: 'done' });
          }
          return next;
        });
      }
      if (data.type === 'batch_status' && data.batch_id) {
        const status = data.status;
        if (status === 'cancelled') {
          setDownloadStates(prev => {
            const next = new Map(prev);
            for (const [key, ds] of next) {
              if (ds.batchId === data.batch_id) next.delete(key);
            }
            return next;
          });
        } else if (['done', 'error'].includes(status)) {
          const batchId = data.batch_id;
          setDownloadStates(prev => {
            const next = new Map(prev);
            for (const [key, ds] of next) {
              if (ds.batchId === batchId) {
                next.set(key, { ...ds, status: status === 'done' ? 'done' : 'error', progress: status === 'done' ? 100 : ds.progress });
              }
            }
            return next;
          });
          setTimeout(() => {
            setDownloadStates(prev => {
              const next = new Map(prev);
              for (const [key, ds] of next) {
                if (ds.batchId === batchId) next.delete(key);
              }
              return next;
            });
          }, 3000);
        } else if (status === 'extracting' || status === 'converting') {
          setDownloadStates(prev => {
            const next = new Map(prev);
            for (const [key, ds] of next) {
              if (ds.batchId === data.batch_id) {
                next.set(key, { ...ds, status });
              }
            }
            return next;
          });
        }
      }
      if (['batch_progress', 'batch_update', 'batch_status'].includes(data.type)) {
        loadStatus();
        if (data.type === 'batch_status' && ['done', 'cancelled', 'error', 'paused'].includes(data.status)) {
          loadPaused(); loadFiles();
          if (data.status === 'done') showToast(`Completada: ${data.folder_name || ''}`, 'success');
          if (data.status === 'error') showToast('Error en la descarga', 'error');
        }
      }
    });
    const q = searchParams.get('q');
    if (q) { doSearch(q); setSearchParams({}, { replace: true }); }
    return () => unsub();
  }, []);

  const doSearch = async (query: string) => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await apiFetch('/search', {
        method: 'POST',
        body: JSON.stringify({
          query: query.trim(), page_size: 50, offset_id: 0, sort_asc: false,
        }),
      });
      const data = await res.json();
      const items: SearchResult[] = data.results || [];
      setResults(items);

      const seriesMap = new Map<string, SearchResult[]>();
      const movieMap = new Map<string, SearchResult[]>();
      const trueSingles: SearchResult[] = [];

      for (const r of items) {
        const parsed = parseTitle(r.file_name);
        if (parsed) {
          const key = parsed.seriesName.toLowerCase();
          if (!seriesMap.has(key)) seriesMap.set(key, []);
          seriesMap.get(key)!.push(r);
        } else {
          const key = cleanTitle(r.file_name).toLowerCase().trim();
          if (!key) { trueSingles.push(r); continue; }
          if (!movieMap.has(key)) movieMap.set(key, []);
          movieMap.get(key)!.push(r);
        }
      }

      const groups: SearchGroup[] = [];
      for (const [, eps] of seriesMap) {
        eps.sort((a, b) => a.file_name.localeCompare(b.file_name, undefined, { numeric: true }));
        const first = parseTitle(eps[0].file_name)!;
        groups.push({ seriesName: first.seriesName, season: first.season, episodes: eps, channelId: eps[0].channel_id });
      }
      groups.sort((a, b) => a.seriesName.localeCompare(b.seriesName));
      setSearchGroups(groups);

      const movieGrps = new Map<string, SearchResult[]>();
      const singles: SearchResult[] = [];
      for (const [key, items] of movieMap) {
        if (items.length > 1) {
          movieGrps.set(items[0].file_name, items);
        } else {
          singles.push(items[0]);
        }
      }
      singles.push(...trueSingles);
      setMovieGroups(movieGrps);
      setSearchSingles(singles);
      lastResultsRef.current = { groups, singles, movieGroups: movieGrps };

      const names = new Set<string>();
      for (const g of groups) names.add(g.seriesName);
      for (const [raw] of movieGrps) names.add(raw);
      for (const s of singles) names.add(s.file_name);
      const uniqueNames = [...names].filter(Boolean);
      if (uniqueNames.length > 0) {
        const meta = await fetchMetadataBatch(uniqueNames);
        setResultsMeta(meta);
      }
    } catch {}
    setSearching(false);
  };

  const download = async (msgId: number, channelId?: number) => {
    try {
      const res = await apiFetch('/download', {
        method: 'POST', body: JSON.stringify({ message_id: msgId, channel_id: channelId }),
      });
      const data = await res.json();
      if (data.error) showToast(data.error, 'error');
      else {
        showToast('Descarga iniciada', 'success');
        loadStatus();
        const parts: any[] = data.parts || [];
        for (const p of parts) {
          setDownloadStates(prev => {
            const next = new Map(prev);
            next.set(p.message_id, {
              messageId: p.message_id,
              batchId: data.batch_id,
              progress: 0,
              status: 'downloading',
            });
            return next;
          });
        }
      }
    } catch {}
  };

  const cancelBatch = async (batchId: string) => {
    await apiFetch('/cancel', { method: 'POST', body: JSON.stringify({ batch_id: batchId }) });
    loadStatus();
  };
  const pauseBatch = async (batchId: string) => {
    await apiFetch('/pause', { method: 'POST', body: JSON.stringify({ batch_id: batchId }) });
    loadStatus(); loadPaused();
  };
  const resumeBatch = async (batchId: string) => {
    await apiFetch('/resume', { method: 'POST', body: JSON.stringify({ batch_id: batchId }) });
    loadPaused(); loadStatus();
  };
  const deleteFile = async (path: string) => {
    await apiFetch('/files', { method: 'DELETE', body: JSON.stringify({ path }) });
    loadFiles(); showToast('Eliminado', 'success');
  };
  const streamUrl = (path: string) => {
    const token = getAccessToken();
    return `/api/stream?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token || '')}`;
  };

  const metaFor = (meta: Map<string, TMDBMetadata>, key: string): TMDBMetadata => {
    return meta.get(key) || { title: key, poster: undefined, year: undefined, rating: undefined };
  };

  const openSearchSeries = (group: SearchGroup) => {
    const meta = metaFor(resultsMeta, group.seriesName);
    const episodes: SeriesEpisode[] = group.episodes.map(r => ({
      name: r.file_name,
      size: r.size_str,
      path: '',
      message_id: r.id,
      channel_id: r.channel_id,
    }));
    setSelectedSeries({
      series: {
        name: group.seriesName,
        is_dir: true,
        size: `${group.episodes.length} episodios`,
        path: '',
        is_series: true,
        clean_name: group.seriesName,
        episodes,
      },
      metadata: meta,
      isSearchResult: true,
    });
  };

  return (
    <Layout>
      {toast && (
        <div className={`fixed top-24 right-6 z-50 px-5 py-3 rounded-2xl shadow-2xl shadow-black/40 text-sm font-medium backdrop-blur-xl border animate-slide-up ${
          toastType === 'success' ? 'bg-green-600/90 border-green-400/20 text-white' : 'bg-netflix-red/90 border-netflix-red/20 text-white'
        }`}>{toast}</div>
      )}

      {selectedSeries && (
        <SeriesDetail
          series={selectedSeries.series}
          metadata={selectedSeries.metadata}
          onClose={() => setSelectedSeries(null)}
          streamUrl={streamUrl}
          onDownload={selectedSeries.isSearchResult ? download : undefined}
          onCancelDownload={selectedSeries.isSearchResult ? (batchId: string) => cancelBatch(batchId) : undefined}
          downloadStates={selectedSeries.isSearchResult ? downloadStates : undefined}
        />
      )}

      {selectedMovie && (
        <MovieDetail
          title={selectedMovie.title}
          metadata={selectedMovie.metadata}
          results={selectedMovie.results}
          onClose={() => setSelectedMovie(null)}
          onDownload={download}
          onCancelDownload={(batchId) => cancelBatch(batchId)}
          downloadStates={downloadStates}
        />
      )}

      {playDetail && (
        <PlayDetail
          name={playDetail.cleanName || playDetail.name}
          size={playDetail.size}
          path={playDetail.path}
          metadata={playDetail.metadata}
          onClose={() => setPlayDetail(null)}
          streamUrl={streamUrl}
          onDelete={() => { deleteFile(playDetail.path); setPlayDetail(null); }}
        />
      )}

      <div className="pt-24 pb-6 px-6 md:px-14">
        <h1 className="text-white text-4xl md:text-5xl font-bold mb-3 tracking-tight animate-fade-in">
          Bienvenido, {username}
        </h1>
        <p className="text-gray-400 text-base md:text-lg animate-fade-in">
          Busca peliculas y series en tus canales de Telegram
        </p>
        {diskFree && <p className="text-gray-600 text-sm mt-1 animate-fade-in">Espacio libre: {diskFree}</p>}
      </div>

      <div className="px-6 md:px-14 mb-6 flex gap-2">
        <button
          onClick={() => setViewMode('search')}
          className={`text-sm font-medium px-5 py-2 rounded-full transition-all ${
            viewMode === 'search'
              ? 'bg-white text-black'
              : 'bg-white/10 text-gray-300 hover:bg-white/20'
          }`}
        >
          Buscar
        </button>
        <button
          onClick={() => setViewMode('library')}
          className={`text-sm font-medium px-5 py-2 rounded-full transition-all ${
            viewMode === 'library'
              ? 'bg-white text-black'
              : 'bg-white/10 text-gray-300 hover:bg-white/20'
          }`}
        >
          Mi Biblioteca
          {allFiles.length > 0 && (
            <span className="ml-1.5 text-xs opacity-60">({allFiles.length})</span>
          )}
        </button>
      </div>

      {viewMode === 'search' && (
        <>
      <div className="px-6 md:px-14 mb-8">
        <div className="flex gap-3 items-center flex-wrap">
          <div className="relative flex-1 min-w-[280px] max-w-xl">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              placeholder="Buscar pelicula o serie..."
              className="w-full bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl pl-11 pr-5 py-3 text-white text-sm outline-none focus:border-white/25 focus:bg-white/8 transition-all duration-300 placeholder-gray-500"
              onKeyDown={(e) => { if (e.key === 'Enter') doSearch((e.target as HTMLInputElement).value); }}
            />
          </div>
        </div>
      </div>

      {searchGroups.length > 0 && (
        <MovieRow title={searching ? 'Buscando...' : 'Series encontradas'}>
          {searchGroups.map(g => {
            const meta = metaFor(resultsMeta, g.seriesName);
            return (
              <MovieCard key={g.seriesName} name={g.seriesName}
                subtitle={`${g.episodes.length} episodios`}
                posterUrl={meta.poster} year={meta.year} rating={meta.rating}
                onClick={() => openSearchSeries(g)} hoverLabel="Ver episodios" actions="click" />
            );
          })}
        </MovieRow>
      )}

      {movieGroups.size > 0 && (
        <MovieRow title="Peliculas encontradas">
          {Array.from(movieGroups.entries()).map(([rawName, items]) => {
            const key = cleanTitle(rawName);
            const meta = metaFor(resultsMeta, key);
            return (
              <MovieCard key={key} name={key}
                subtitle={`${items.length} versiones`}
                posterUrl={meta.poster} year={meta.year} rating={meta.rating}
                onClick={() => setSelectedMovie({ title: key, metadata: meta, results: items })}
                actions="click" />
            );
          })}
        </MovieRow>
      )}

      {searchSingles.length > 0 && (
        <MovieRow title={searchGroups.length > 0 || movieGroups.size > 0 ? 'Otros resultados' : 'Resultados'}>
          {searchSingles.map(r => {
            const meta = metaFor(resultsMeta, cleanTitle(r.file_name));
            return (
              <MovieCard key={r.id} name={r.file_name} subtitle={r.channel_name} size={r.size_str}
                posterUrl={meta.poster} year={meta.year} rating={meta.rating}
                onPlay={r.downloaded ? () => window.open(streamUrl(''), '_blank') : undefined}
                onDownload={r.downloaded ? undefined : () => download(r.id, r.channel_id)}
                onCancelDownload={() => cancelBatch(downloadStates.get(r.id)?.batchId || '')}
                downloadState={downloadStates.get(r.id)}
                downloaded={r.downloaded} actions={r.downloaded ? 'play' : 'download'} />
            );
          })}
        </MovieRow>
      )}

      {searching && results.length === 0 && (
        <div className="px-6 md:px-14 py-8 text-center text-gray-500">Buscando...</div>
      )}
      </>
      )}

      {viewMode === 'library' && (
        <>
      {batches.filter(b => ['downloading', 'extracting', 'converting'].includes(b.status)).length > 0 && (
        <MovieRow title="Descargando">
          {batches.filter(b => ['downloading', 'extracting', 'converting'].includes(b.status)).map(b => {
            const name = cleanTitle(b.folder_name);
            const meta = downloadingMeta.get(name) || { title: name };
            const ds: DownloadState = {
              messageId: 0,
              batchId: b.batch_id,
              progress: b.progress,
              status: b.status === 'extracting' ? 'extracting' : b.status === 'converting' ? 'converting' : 'downloading',
            };
            return (
              <MovieCard key={b.batch_id} name={name}
                subtitle={b.status === 'extracting' ? 'Extrayendo...' : b.status === 'converting' ? 'Convirtiendo...' : `${b.progress}%`}
                posterUrl={meta.poster} year={meta.year} rating={meta.rating}
                downloadState={ds} onCancelDownload={() => cancelBatch(b.batch_id)} actions="click" />
            );
          })}
        </MovieRow>
      )}

      {series.length > 0 && (
        <MovieRow title="Series">
          {series.map(s => {
            const meta = metaFor(filesMeta, s.clean_name || s.name);
            return (
              <MovieCard key={s.path} name={s.name} size={s.size}
                posterUrl={meta.poster} year={meta.year} rating={meta.rating}
                onClick={() => {
                  const sl = lastResultsRef.current;
                  const downloadEpisodes: SeriesEpisode[] = [];
                  for (const g of sl.groups) {
                    if (cleanTitle(g.seriesName).toLowerCase() === (s.clean_name || s.name).toLowerCase()) {
                      for (const ep of g.episodes) {
                        const exists = (s.episodes || []).some(e => cleanTitle(e.name).toLowerCase() === cleanTitle(ep.file_name).toLowerCase());
                        if (!exists) {
                          downloadEpisodes.push({
                            name: ep.file_name,
                            size: ep.size_str,
                            path: '',
                            message_id: ep.id,
                            channel_id: ep.channel_id,
                          });
                        }
                      }
                      break;
                    }
                  }
                  const seriesData = { ...s };
                  if (downloadEpisodes.length > 0) {
                    seriesData.episodes = [...(s.episodes || []), ...downloadEpisodes];
                  }
                  setSelectedSeries({ series: seriesData, metadata: meta, isSearchResult: false });
                }}
                hoverLabel="Ver episodios" actions="click" />
            );
          })}
        </MovieRow>
      )}

      {movies.length > 0 && (
        <MovieRow title="Peliculas">
          {movies.map(f => {
            const meta = metaFor(filesMeta, f.clean_name || f.name);
            return (
              <MovieCard key={f.path} name={f.name} size={f.size}
                posterUrl={meta.poster} year={meta.year} rating={meta.rating}
                onClick={() => setPlayDetail({ name: f.name, size: f.size, path: f.path, cleanName: f.clean_name || '', metadata: meta })}
                downloaded actions="click" />
            );
          })}
        </MovieRow>
      )}

      {allFiles.length === 0 && (
        <div className="px-6 md:px-14 py-16 text-center">
          <p className="text-gray-500 text-lg mb-2">Tu biblioteca esta vacia</p>
          <p className="text-gray-600 text-sm">Descarga peliculas y series para verlas aqui</p>
        </div>
      )}
      </>
      )}

      {viewMode === 'search' && allFiles.length === 0 && results.length === 0 && !searching && (
        <div className="px-6 md:px-14 py-8 text-center text-gray-600 text-sm">
          Busca una pelicula o serie para empezar a descargar
        </div>
      )}

      <DownloadBar batches={batches} onPause={pauseBatch} onCancel={cancelBatch} downloadStates={downloadStates} />
    </Layout>
  );
}
