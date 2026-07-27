import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch, getAccessToken } from '../services/api';
import Layout from '../components/Layout';
import DownloadBar from '../components/DownloadBar';
import MovieRow from '../components/MovieRow';
import MovieCard from '../components/MovieCard';
import SeriesDetail from '../components/SeriesDetail';
import MovieDetail from '../components/MovieDetail';
import SearchView from './SearchView';
import { cleanTitle } from '../utils/text';
import { useDownloads } from '../hooks/useDownloads';
import type { BrowseRow, BrowseItem, TMDBMetadata, IndexChannelStatus, SeriesEpisode, SearchResult } from '../types';

export default function Home() {
  const { username } = useAuth();
  const [rows, setRows] = useState<BrowseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSeries, setSelectedSeries] = useState<{ title: string; metadata: TMDBMetadata; channelId?: number; episodes: SeriesEpisode[]; tmdbId?: number } | null>(null);
  const [selectedMovie, setSelectedMovie] = useState<{ title: string; metadata: TMDBMetadata; channelId?: number; results: SearchResult[] } | null>(null);
  const [indexChannels, setIndexChannels] = useState<IndexChannelStatus[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchGroups, setSearchGroups] = useState<any[]>([]);
  const [searchSingles, setSearchSingles] = useState<SearchResult[]>([]);
  const [movieGroups, setMovieGroups] = useState<Map<string, SearchResult[]>>(new Map());

  const { batches, pausedBatches, downloadStates, loadPaused, download, cancelBatch, pauseBatch, resumeBatch } = useDownloads();

  const doSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchGroups([]);
      setSearchSingles([]);
      setMovieGroups(new Map());
      setSearching(false);
      return;
    }
    setSearching(true);
    try {
      const res = await apiFetch('/search', { method: 'POST', body: JSON.stringify({ query: query.trim(), page_size: 100 }) });
      const data = await res.json();
      const results: SearchResult[] = data.results || [];

      const groups: any[] = [];
      const singles: SearchResult[] = [];
      const movieMap = new Map<string, SearchResult[]>();

      for (const r of results) {
        const m = r.file_name.match(/(\d{1,2})x(\d{2})/i)
               || r.file_name.match(/[sS](\d{2})[eE](\d{2})/)
               || r.file_name.match(/\[[Ss]\s*(\d{1,2})\s*[Ee]\s*(\d{1,2})\]/);
        if (m) {
          const ctitle = cleanTitle(r.file_name);
          const words = ctitle.split(/\s+/);
          const key = words.length >= 3 ? words.slice(0, 3).join(' ') : ctitle;
          let found = false;
          for (const g of groups) {
            if (g.groupKey === key) { g.episodes.push(r); found = true; break; }
          }
          if (!found) {
            groups.push({ groupKey: key, seriesName: ctitle, season: parseInt(m[1]), episode: parseInt(m[2]), episodes: [r], channelId: r.channel_id });
          }
          continue;
        }
        const cname = cleanTitle(r.file_name);
        if (cname && cname.length > 1) {
          if (!movieMap.has(cname)) movieMap.set(cname, []);
          movieMap.get(cname)!.push(r);
        } else {
          singles.push(r);
        }
      }

      setSearchGroups(groups);
      setSearchSingles(singles);
      setMovieGroups(movieMap);
    } catch {} finally { setSearching(false); }
  }, []);

  const handleQueryChange = useCallback((query: string) => {
    setSearchQuery(query);
    doSearch(query);
  }, [doSearch]);

  const loadHome = async () => {
    try {
      const res = await apiFetch('/browse/home');
      const data = await res.json();
      setRows(data.rows || []);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => {
    loadHome();
    loadPaused();
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

  const handleSeriesClick = async (item: BrowseItem) => {
    const meta: TMDBMetadata = {
      title: item.title, poster: item.poster, backdrop: item.backdrop,
      year: item.year, rating: item.rating, overview: item.overview, genres: item.genres,
    };
    const tmdbId = item.id.startsWith('s') ? parseInt(item.id.slice(1)) : undefined;
    try {
      const res = await apiFetch('/search', { method: 'POST', body: JSON.stringify({ query: item.title, page_size: 100 }) });
      const data = await res.json();
      const results: SearchResult[] = data.results || [];
      const episodes: SeriesEpisode[] = results.map((r: SearchResult) => ({
        name: r.file_name, size: r.size_str, path: '', message_id: r.id, channel_id: r.channel_id,
      }));
      setSelectedSeries({ title: item.title, metadata: meta, channelId: item.channel_id, episodes, tmdbId });
    } catch {
      setSelectedSeries({ title: item.title, metadata: meta, channelId: item.channel_id, episodes: [], tmdbId });
    }
  };

  const handleMovieClick = async (item: BrowseItem) => {
    const meta: TMDBMetadata = {
      title: item.title, poster: item.poster, backdrop: item.backdrop,
      year: item.year, rating: item.rating, overview: item.overview, genres: item.genres,
    };
    try {
      const res = await apiFetch('/search', { method: 'POST', body: JSON.stringify({ query: item.title, page_size: 20 }) });
      const data = await res.json();
      const results: SearchResult[] = (data.results || []).filter((r: SearchResult) =>
        !/(\d{1,2}x\d{2}|s\d{2}e\d{2})/i.test(r.file_name)
      );
      setSelectedMovie({ title: item.title, metadata: meta, results, channelId: item.channel_id });
    } catch {
      setSelectedMovie({ title: item.title, metadata: meta, results: [], channelId: item.channel_id });
    }
  };

  const tmdbFromResult = (r: SearchResult): TMDBMetadata => ({
    title: r.tmdb_title || r.clean_name || r.file_name, year: r.tmdb_year, rating: r.tmdb_rating,
    poster: r.tmdb_poster, backdrop: r.tmdb_backdrop, overview: r.tmdb_overview, media_type: r.media_type, genres: r.tmdb_genres,
  });

  const handleDownload = async (msgId: number, channelId?: number) => {
    await download(msgId, channelId);
  };

  const openSearchSeries = (group: any) => {
    const meta = tmdbFromResult(group.episodes[0]);
    const episodes: SeriesEpisode[] = group.episodes.map((r: SearchResult) => ({
      name: r.file_name, size: r.size_str, path: '', message_id: r.id, channel_id: r.channel_id,
    }));
    setSelectedSeries({ title: group.groupKey, metadata: meta, channelId: group.channelId, episodes, tmdbId: undefined });
  };

  const streamUrl = (path: string) => `/api/stream?path=${encodeURIComponent(path)}&token=${encodeURIComponent(getAccessToken() || '')}`;

  const hasSearchResults = searchSingles.length > 0 || searchGroups.length > 0 || movieGroups.size > 0;
  const showBrowse = !searchQuery && !hasSearchResults;

  return (
    <Layout>
      <div className="pt-20 pb-2 px-6 md:px-14">
        <h1 className="text-white text-4xl md:text-5xl font-bold mb-2 tracking-tight animate-fade-in">Bienvenido, {username}</h1>
        <p className="text-gray-400 text-base md:text-lg animate-fade-in">Explora peliculas y series en tus canales de Telegram</p>
      </div>

      <SearchView
        searching={searching}
        searchGroups={searchGroups}
        searchSingles={searchSingles}
        movieGroups={movieGroups}
        downloadStates={downloadStates}
        onSearch={(q) => doSearch(q)}
        onDownload={handleDownload}
        onCancelBatch={cancelBatch}
        onOpenSeries={openSearchSeries}
        onOpenMovie={(t, m, r) => setSelectedMovie({ title: t, metadata: m, results: r, channelId: r[0]?.channel_id })}
        tmdbFromResult={tmdbFromResult}
        streamUrl={streamUrl}
        onQueryChange={handleQueryChange}
        alwaysShowBar={true}
      />

      {showBrowse && (
        <>
          {loading && <div className="px-6 md:px-14 py-20 text-center text-gray-500">Cargando...</div>}

          {rows.map(row => (
            <MovieRow key={row.genre} title={row.genre}>
              {row.items.map(item => (
                <MovieCard
                  key={item.id}
                  name={item.title}
                  posterUrl={item.poster}
                  year={item.year}
                  rating={item.rating}
                  genres={item.genres}
                  subtitle={item.media_type === 'series' && item.episode_count ? `${item.episode_count} episodios` : ''}
                  onClick={() => item.media_type === 'series' ? handleSeriesClick(item) : handleMovieClick(item)}
                  hoverLabel={item.media_type === 'series' ? 'Ver episodios' : 'Ver detalles'}
                  actions="click"
                />
              ))}
            </MovieRow>
          ))}

          {!loading && rows.length === 0 && (
            <div className="px-6 md:px-14 py-16 text-center">
              <p className="text-gray-500 text-lg mb-2">No hay contenido indexado</p>
              <p className="text-gray-600 text-sm">Añade canales en la seccion de administracion</p>
            </div>
          )}
        </>
      )}

      {selectedSeries && (
        <SeriesDetail
          series={{ name: selectedSeries.title, is_dir: true, size: `${selectedSeries.episodes.length} episodios`, path: '', is_series: true, clean_name: selectedSeries.title, episodes: selectedSeries.episodes }}
          metadata={selectedSeries.metadata}
          onClose={() => setSelectedSeries(null)}
          streamUrl={streamUrl}
          onDownload={(msgId, channelId) => download(msgId, channelId)}
          onCancelDownload={(id) => cancelBatch(id)}
          downloadStates={downloadStates}
          tmdbId={selectedSeries.tmdbId}
        />
      )}

      {selectedMovie && (
        <MovieDetail
          title={selectedMovie.title}
          metadata={selectedMovie.metadata}
          results={selectedMovie.results}
          onClose={() => setSelectedMovie(null)}
          onDownload={(msgId, channelId) => download(msgId, channelId)}
          onCancelDownload={(id) => cancelBatch(id)}
          downloadStates={downloadStates}
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
