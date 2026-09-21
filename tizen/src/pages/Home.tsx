import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getElement } from '../focus/engine';
import { FocusScope } from '../focus/react';
import { apiFetch, streamUrl } from '../services/api';
import Layout from '../components/Layout';
import DownloadBar from '../components/DownloadBar';
import MovieRow from '../components/MovieRow';
import MovieCard from '../components/MovieCard';
import FocusableButton from '../components/FocusableButton';
import SeriesDetail from '../components/SeriesDetail';
import MovieDetail from '../components/MovieDetail';
import SearchView from './SearchView';
import { cleanTitle } from '../utils/text';
import { useDownloads } from '../hooks/useDownloads';
import type { BrowseRow, BrowseItem, TMDBMetadata, IndexChannelStatus, SeriesEpisode, SearchResult } from '../types';

export default function Home() {
  const { username, isAdmin } = useAuth();
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

  const [focusRow, setFocusRow] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef(0);

  /** Margen que se deja por encima de la fila enfocada (barra + cabecera). */
  const TOP_PADDING = 200;

  /**
   * Se llama cuando el foco entra en un hijo de la columna. El hijo 0 es el
   * bloque de busqueda; a partir del 1 son las filas del catalogo.
   *
   * Se leen offsetTop/offsetHeight de UN elemento, el que acaba de recibir el
   * foco. El motor anterior medía los ~260 de la pantalla en cada pulsacion.
   */
  const handleVerticalFocus = useCallback((childIndex: number, childId: string) => {
    setFocusRow(childIndex - 1);

    const wrap = contentRef.current;
    if (!wrap) return;

    if (childIndex === 0) {
      scrollRef.current = 0;
      wrap.style.transform = 'translate3d(0,0,0)';
      return;
    }

    const el = getElement(childId);
    if (!el) return;

    const top = el.offsetTop;
    const height = el.offsetHeight;
    const viewHeight = window.innerHeight;
    let next = scrollRef.current;

    if (top - next < TOP_PADDING) {
      next = Math.max(0, top - TOP_PADDING);
    } else if (top + height - next > viewHeight - 40) {
      next = top + height - viewHeight + 40;
    }

    if (next !== scrollRef.current) {
      scrollRef.current = next;
      wrap.style.transform = `translate3d(0, ${-next}px, 0)`;
    }
  }, []);

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
  }, []);

  useEffect(() => {
    // /index/progress solo lo sirve un admin: pollearlo como usuario normal
    // provocaba un 403 cada 5 segundos.
    if (!isAdmin) return;
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
  }, [isAdmin]);

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



  const hasSearchResults = searchSingles.length > 0 || searchGroups.length > 0 || movieGroups.size > 0;
  const showBrowse = !searchQuery && !hasSearchResults;

  /*
   * Ventana vertical: de las 12 filas que manda el backend solo montan sus
   * tarjetas las cercanas al foco. El armazon de la fila (titulo y hueco con
   * altura minima) se pinta siempre, asi que el layout no salta.
   *
   * El margen tiene que cubrir todo lo que se ve, no solo lo alcanzable en una
   * pulsacion: en 1080p caben tres o cuatro filas a la vez y el desplazamiento
   * deja varias por encima de la enfocada. Con margenes mas cortos las filas
   * de arriba se vaciaban estando aun en pantalla y parecia que desaparecian.
   */
  const ROWS_ABOVE = 3;
  const ROWS_BELOW = 3;
  const isRowMounted = (rowIdx: number) =>
    rowIdx >= focusRow - ROWS_ABOVE && rowIdx <= focusRow + ROWS_BELOW;

  return (
    <Layout>
      <FocusScope orientation="vertical" index={1} onChildFocus={handleVerticalFocus} as="none">
        {/* El desplazamiento vertical se hace con transform, no con el scroll
            del navegador: es compositor puro y va sincronizado con el foco. */}
        <div ref={contentRef} className="relative" style={{ transform: 'translate3d(0,0,0)' }}>
          <div className="pt-20 pb-2 px-6 md:px-14">
            <h1 className="text-white text-4xl md:text-5xl font-bold mb-2 tracking-tight">Bienvenido, {username}</h1>
            <p className="text-gray-400 text-base md:text-lg">Explora peliculas y series en tus canales de Telegram</p>
          </div>

          <SearchView
            index={0}
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

              {rows.map((row, rowIdx) => (
                <MovieRow key={row.genre} index={rowIdx + 1} title={row.genre}>
                  {isRowMounted(rowIdx)
                    ? row.items.map((item, itemIdx) => (
                        <MovieCard
                          key={item.id}
                          index={itemIdx}
                          forceFocus={rowIdx === 0 && itemIdx === 0}
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
                      ))
                    : null}
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

          {pausedBatches.length > 0 && (
            <div className="px-6 md:px-14 mb-10">
              <h2 className="text-white text-lg font-medium mb-3">Pausadas</h2>
              <FocusScope orientation="horizontal" index={rows.length + 1}>
                <div className="flex gap-3 flex-wrap">
                  {pausedBatches.map((b: any, i: number) => (
                    <div key={b.batch_id} className="bg-white/5 border border-white/10 rounded-xl px-5 py-4">
                      <p className="text-white text-sm font-medium">{b.folder_name}</p>
                      <p className="text-gray-500 text-xs mt-1 mb-3">{b.total_parts} partes · {b.total_size_str}</p>
                      <FocusableButton
                        index={i}
                        onClick={() => resumeBatch(b.batch_id)}
                        className="bg-netflix-red text-white text-xs px-4 py-2 rounded-lg font-medium"
                      >
                        Reanudar
                      </FocusableButton>
                    </div>
                  ))}
                </div>
              </FocusScope>
            </div>
          )}
        </div>
      </FocusScope>

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

      <DownloadBar batches={batches} onPause={pauseBatch} onCancel={cancelBatch} downloadStates={downloadStates} indexChannels={indexChannels} />
    </Layout>
  );
}
