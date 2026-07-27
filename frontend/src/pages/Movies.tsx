import { useState, useEffect } from 'react';
import { apiFetch, getAccessToken } from '../services/api';
import Layout from '../components/Layout';
import MovieRow from '../components/MovieRow';
import MovieCard from '../components/MovieCard';
import MovieDetail from '../components/MovieDetail';
import SeriesDetail from '../components/SeriesDetail';
import type { BrowseRow, BrowseItem, TMDBMetadata, SearchResult, SeriesEpisode } from '../types';

export default function Movies() {
  const [rows, setRows] = useState<BrowseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMovie, setSelectedMovie] = useState<{ title: string; metadata: TMDBMetadata; results: SearchResult[] } | null>(null);
  const [selectedSeries, setSelectedSeries] = useState<{ title: string; metadata: TMDBMetadata; episodes: SeriesEpisode[]; tmdbId?: number } | null>(null);
  const [downloadStates] = useState(new Map());

  useEffect(() => {
    const load = async () => {
      try {
        const res = await apiFetch('/browse/home');
        const data = await res.json();
        const movieOnly = (data.rows || []).map((row: BrowseRow) => ({
          ...row,
          items: row.items.filter((i: BrowseItem) => i.media_type === 'movie'),
        })).filter((row: BrowseRow) => row.items.length > 0);
        setRows(movieOnly);
      } catch {} finally { setLoading(false); }
    };
    load();
  }, []);

  const handleClick = async (item: BrowseItem) => {
    const meta: TMDBMetadata = {
      title: item.title, poster: item.poster, backdrop: item.backdrop,
      year: item.year, rating: item.rating, overview: item.overview, genres: item.genres,
    };
    if (item.media_type === 'series') {
      const tmdbId = item.id.startsWith('s') ? parseInt(item.id.slice(1)) : undefined;
      try {
        const res = await apiFetch('/search', { method: 'POST', body: JSON.stringify({ query: item.title, page_size: 100 }) });
        const data = await res.json();
        const results: SearchResult[] = data.results || [];
        const episodes: SeriesEpisode[] = results.map((r: SearchResult) => ({
          name: r.file_name, size: r.size_str, path: '', message_id: r.id, channel_id: r.channel_id,
        }));
        setSelectedSeries({ title: item.title, metadata: meta, episodes, tmdbId });
      } catch {
        setSelectedSeries({ title: item.title, metadata: meta, episodes: [], tmdbId });
      }
    } else {
      try {
        const res = await apiFetch('/search', { method: 'POST', body: JSON.stringify({ query: item.title, page_size: 20 }) });
        const data = await res.json();
        const results: SearchResult[] = (data.results || []).filter((r: SearchResult) =>
          !/(\d{1,2}x\d{2}|s\d{2}e\d{2})/i.test(r.file_name)
        );
        setSelectedMovie({ title: item.title, metadata: meta, results });
      } catch {
        setSelectedMovie({ title: item.title, metadata: meta, results: [] });
      }
    }
  };

  const streamUrl = (path: string) => `/api/stream?path=${encodeURIComponent(path)}&token=${encodeURIComponent(getAccessToken() || '')}`;

  return (
    <Layout>
      <div className="pt-20 pb-4 px-6 md:px-14">
        <h1 className="text-white text-4xl md:text-5xl font-bold mb-2 tracking-tight animate-fade-in">Películas</h1>
        <p className="text-gray-400 text-base md:text-lg animate-fade-in">Todas las películas indexadas</p>
      </div>

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
              hoverLabel="Ver detalles"
              actions="click"
              onClick={() => handleClick(item)}
            />
          ))}
        </MovieRow>
      ))}

      {!loading && rows.length === 0 && (
        <div className="px-6 md:px-14 py-16 text-center"><p className="text-gray-500 text-lg">No hay peliculas indexadas</p></div>
      )}

      {selectedMovie && (
        <MovieDetail
          title={selectedMovie.title}
          metadata={selectedMovie.metadata}
          results={selectedMovie.results}
          onClose={() => setSelectedMovie(null)}
          onDownload={() => {}}
          onCancelDownload={() => {}}
          downloadStates={downloadStates}
        />
      )}

      {selectedSeries && (
        <SeriesDetail
          series={{ name: selectedSeries.title, is_dir: true, size: `${selectedSeries.episodes.length} episodios`, path: '', is_series: true, clean_name: selectedSeries.title, episodes: selectedSeries.episodes }}
          metadata={selectedSeries.metadata}
          onClose={() => setSelectedSeries(null)}
          streamUrl={streamUrl}
          tmdbId={selectedSeries.tmdbId}
        />
      )}
    </Layout>
  );
}
