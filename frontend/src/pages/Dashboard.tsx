import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../services/api';
import { getAccessToken } from '../services/api';
import Layout from '../components/Layout';
import DownloadBar from '../components/DownloadBar';
import SeriesDetail from '../components/SeriesDetail';
import MovieDetail from '../components/MovieDetail';
import PlayDetail from '../components/PlayDetail';
import { cleanTitle } from '../utils/text';
import { useDownloads } from '../hooks/useDownloads';
import { useSearch } from '../hooks/useSearch';
import SearchView from './SearchView';
import LibraryView from './LibraryView';
import type { SearchResult, Channel, FileItem, TMDBMetadata, SeriesEpisode, IndexChannelStatus } from '../types';

export default function Dashboard() {
  const { username } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [diskFree, setDiskFree] = useState('');
  const [viewMode, setViewMode] = useState<'search' | 'library'>('search');

  const { batches, pausedBatches, downloadStates, loadStatus, loadPaused, download, cancelBatch, pauseBatch, resumeBatch } = useDownloads();
  const { results, searchGroups, searchSingles, movieGroups, searching, doSearch, lastResultsRef } = useSearch();

  const [selectedSeries, setSelectedSeries] = useState<{ series: FileItem; metadata: TMDBMetadata; isSearchResult?: boolean } | null>(null);
  const [selectedMovie, setSelectedMovie] = useState<{ title: string; metadata: TMDBMetadata; results: SearchResult[] } | null>(null);
  const [playDetail, setPlayDetail] = useState<{ name: string; size: string; path: string; cleanName: string; metadata: TMDBMetadata } | null>(null);
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error'>('success');
  const [indexChannels, setIndexChannels] = useState<IndexChannelStatus[]>([]);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg); setToastType(type); setTimeout(() => setToast(''), 3000);
  };

  const loadChannels = useCallback(async () => {
    try { const res = await apiFetch('/channels'); setChannels((await res.json()).channels || []); } catch {}
  }, []);

  useEffect(() => {
    loadChannels();
    const updateDisk = async () => { const df = await loadStatus(); if (df) setDiskFree(df); };
    updateDisk(); loadPaused();
    const q = searchParams.get('q');
    if (q) { doSearch(q); setSearchParams({}, { replace: true }); }
    const fetchIndex = async () => {
      try {
        const res = await apiFetch('/index/progress');
        const data = await res.json();
        setIndexChannels(data.channels || []);
      } catch {}
    };
    fetchIndex();
    const interval = setInterval(fetchIndex, 5000);
    return () => clearInterval(interval);
  }, []);

  const deleteFile = async (path: string) => {
    await apiFetch('/files', { method: 'DELETE', body: JSON.stringify({ path }) });
    if (playDetail?.path === path) setPlayDetail(null);
    showToast('Eliminado', 'success');
  };

  const streamUrl = (path: string) => `/api/stream?path=${encodeURIComponent(path)}&token=${encodeURIComponent(getAccessToken() || '')}`;

  const tmdbFromResult = (r: SearchResult): TMDBMetadata => ({
    title: r.tmdb_title || r.clean_name || r.file_name, year: r.tmdb_year, rating: r.tmdb_rating,
    poster: r.tmdb_poster, backdrop: r.tmdb_backdrop, overview: r.tmdb_overview, media_type: r.media_type, genres: r.tmdb_genres,
  });

  const handleDownload = async (msgId: number, channelId?: number) => {
    const err = await download(msgId, channelId);
    if (err) showToast(err, 'error'); else showToast('Descarga iniciada', 'success');
  };

  const openSearchSeries = (group: any) => {
    const meta = tmdbFromResult(group.episodes[0]);
    const episodes: SeriesEpisode[] = group.episodes.map((r: SearchResult) => ({ name: r.file_name, size: r.size_str, path: '', message_id: r.id, channel_id: r.channel_id }));
    setSelectedSeries({ series: { name: group.seriesName, is_dir: true, size: `${group.episodes.length} episodios`, path: '', is_series: true, clean_name: group.seriesName, episodes }, metadata: meta, isSearchResult: true });
  };

  const openLibrarySeries = (s: FileItem, meta: TMDBMetadata) => {
    const sl = lastResultsRef.current;
    const downloadEpisodes: SeriesEpisode[] = [];
    for (const g of sl.groups) {
      if (cleanTitle(g.seriesName).toLowerCase() === (s.clean_name || s.name).toLowerCase()) {
        for (const ep of g.episodes) {
          const exists = (s.episodes || []).some(e => cleanTitle(e.name).toLowerCase() === cleanTitle(ep.file_name).toLowerCase());
          if (!exists) downloadEpisodes.push({ name: ep.file_name, size: ep.size_str, path: '', message_id: ep.id, channel_id: ep.channel_id });
        }
        break;
      }
    }
    const sd = { ...s };
    if (downloadEpisodes.length > 0) sd.episodes = [...(s.episodes || []), ...downloadEpisodes];
    setSelectedSeries({ series: sd, metadata: meta, isSearchResult: false });
  };

  return (
    <Layout>
      {toast && (
        <div className={`fixed top-24 right-6 z-50 px-5 py-3 rounded-2xl shadow-2xl shadow-black/40 text-sm font-medium backdrop-blur-xl border animate-slide-up ${toastType === 'success' ? 'bg-green-600/90 border-green-400/20 text-white' : 'bg-netflix-red/90 border-netflix-red/20 text-white'}`}>{toast}</div>
      )}
      {selectedSeries && <SeriesDetail series={selectedSeries.series} metadata={selectedSeries.metadata} onClose={() => setSelectedSeries(null)} streamUrl={streamUrl} onDownload={selectedSeries.isSearchResult ? handleDownload : undefined} onCancelDownload={selectedSeries.isSearchResult ? (id: string) => cancelBatch(id) : undefined} downloadStates={selectedSeries.isSearchResult ? downloadStates : undefined} />}
      {selectedMovie && <MovieDetail title={selectedMovie.title} metadata={selectedMovie.metadata} results={selectedMovie.results} onClose={() => setSelectedMovie(null)} onDownload={handleDownload} onCancelDownload={(id) => cancelBatch(id)} downloadStates={downloadStates} />}
      {playDetail && <PlayDetail name={playDetail.cleanName || playDetail.name} size={playDetail.size} path={playDetail.path} metadata={playDetail.metadata} onClose={() => setPlayDetail(null)} streamUrl={streamUrl} onDelete={() => { deleteFile(playDetail.path); setPlayDetail(null); }} />}

      <div className="pt-24 pb-6 px-6 md:px-14">
        <h1 className="text-white text-4xl md:text-5xl font-bold mb-3 tracking-tight animate-fade-in">Bienvenido, {username}</h1>
        <p className="text-gray-400 text-base md:text-lg animate-fade-in">Busca peliculas y series en tus canales de Telegram</p>
        {diskFree && <p className="text-gray-600 text-sm mt-1 animate-fade-in">Espacio libre: {diskFree}</p>}
      </div>

      <div className="px-6 md:px-14 mb-6 flex gap-2">
        <button onClick={() => setViewMode('search')} className={`text-sm font-medium px-5 py-2 rounded-full transition-all ${viewMode === 'search' ? 'bg-white text-black' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}>Buscar</button>
        <button onClick={() => setViewMode('library')} className={`text-sm font-medium px-5 py-2 rounded-full transition-all ${viewMode === 'library' ? 'bg-white text-black' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}>Mi Biblioteca</button>
      </div>

      {viewMode === 'search' && (
        <SearchView
          searching={searching} searchGroups={searchGroups} searchSingles={searchSingles} movieGroups={movieGroups}
          downloadStates={downloadStates} onSearch={doSearch} onDownload={handleDownload}
          onCancelBatch={cancelBatch} onOpenSeries={openSearchSeries}
          onOpenMovie={(t, m, r) => setSelectedMovie({ title: t, metadata: m, results: r })}
          tmdbFromResult={tmdbFromResult} streamUrl={streamUrl}
        />
      )}

      {viewMode === 'library' && (
        <LibraryView
          batches={batches} downloadStates={downloadStates} onCancelBatch={cancelBatch}
          onSeriesClick={openLibrarySeries}
          onMovieClick={(n, s, p, cn, m) => setPlayDetail({ name: n, size: s, path: p, cleanName: cn, metadata: m })}
          lastResultsRef={lastResultsRef}
        />
      )}

      {pausedBatches.length > 0 && (
        <div className="px-6 md:px-14 mb-10">
          <h2 className="text-white text-lg font-medium mb-3">Pausadas</h2>
          <div className="flex gap-3 flex-wrap">
            {pausedBatches.map((b: any) => (
              <div key={b.batch_id} className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl px-5 py-4 shadow-lg">
                <p className="text-white text-sm font-medium">{b.folder_name}</p>
                <p className="text-gray-500 text-xs mt-1 mb-3">{b.total_parts} partes · {b.total_size_str}</p>
                <button onClick={() => resumeBatch(b.batch_id)} className="bg-netflix-red hover:bg-netflix-red-hover text-white text-xs px-4 py-2 rounded-lg transition-colors font-medium">Reanudar</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <DownloadBar batches={batches} onPause={pauseBatch} onCancel={cancelBatch} downloadStates={downloadStates} indexChannels={indexChannels} />
    </Layout>
  );
}
