import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getElement } from '../focus/engine';
import { FocusScope } from '../focus/react';
import { apiFetch } from '../services/api';
import { fetchMediaFiles } from '../services/media';
import { groupSearchResults, type SearchSeriesGroup } from '../utils/search';
import { cleanTitle } from '../utils/text';
import { useContentFocus, useScreenBack } from '../components/Screen';
import Keyboard from '../components/Keyboard';
import Row from '../components/Row';
import PosterCard from '../components/PosterCard';
import TitleDetail, { type DetailInput } from '../components/TitleDetail';
import type { Featured, SearchResult } from '../types';

const RESULTS_X = 830;
const DEBOUNCE_MS = 350;

function metaOf(r: SearchResult, key: string, kind: 'movie' | 'series', title: string, subtitle?: string): Featured {
  return {
    key, kind, title,
    poster: r.tmdb_poster, backdrop: r.tmdb_backdrop, year: r.tmdb_year, rating: r.tmdb_rating,
    overview: r.tmdb_overview, genres: r.tmdb_genres, subtitle,
  };
}

/**
 * Busqueda: teclado a la izquierda, resultados a la derecha segun se escribe.
 * No hay campo de texto ni IME: todo va con el mando.
 */
export default function Search() {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [series, setSeries] = useState<SearchSeriesGroup[]>([]);
  const [movies, setMovies] = useState<[string, SearchResult[]][]>([]);
  const [detail, setDetail] = useState<DetailInput | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const offset = useRef(0);

  useScreenBack();
  useContentFocus(true, 'search-keyboard');

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    if (q.length < 2) { setSeries([]); setMovies([]); setSearching(false); return; }
    setSearching(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await apiFetch('/search', { method: 'POST', body: JSON.stringify({ query: q, page_size: 100 }) });
        const data = await res.json();
        const g = groupSearchResults(data.results || []);
        setSeries(g.groups);
        setMovies([...g.movieGroups.entries()]);
      } catch { /* sin resultados */ } finally { setSearching(false); }
    }, DEBOUNCE_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query]);

  const seriesCards = useMemo(() => series.map((g) => {
    const first = g.episodes[0];
    return { g, f: metaOf(first, `s-${g.groupKey}`, 'series', g.seriesName, `${g.episodes.length} episodios encontrados`) };
  }), [series]);

  const movieCards = useMemo(() => movies.map(([key, items]) => {
    const first = items[0];
    const title = first.tmdb_title || cleanTitle(first.file_name);
    return { key, items, f: metaOf(first, `m-${key}`, 'movie', title, `${items.length} ${items.length === 1 ? 'archivo' : 'archivos'}`) };
  }), [movies]);

  const openSeries = useCallback(async (g: SearchSeriesGroup, f: Featured) => {
    if (g.tmdbId) {
      try {
        const { results } = await fetchMediaFiles(g.tmdbId, 'tv');
        if (results.length) { setDetail({ kind: 'series', tmdbId: g.tmdbId, meta: f, files: results }); return; }
      } catch { /* se usa lo encontrado */ }
    }
    setDetail({ kind: 'series', tmdbId: g.tmdbId, meta: f, files: g.episodes });
  }, []);

  const openMovie = useCallback(async (items: SearchResult[], f: Featured) => {
    const id = items[0].tmdb_id;
    if (id) {
      try {
        const { results } = await fetchMediaFiles(id, 'movie');
        if (results.length) { setDetail({ kind: 'movie', tmdbId: id, meta: f, files: results }); return; }
      } catch { /* se usa lo encontrado */ }
    }
    setDetail({ kind: 'movie', tmdbId: id, meta: f, files: items });
  }, []);

  const onResultsFocus = useCallback((_i: number, childId: string) => {
    const wrap = resultsRef.current;
    const el = getElement(childId);
    if (!wrap || !el) return;
    const next = Math.max(0, el.offsetTop);
    if (next !== offset.current) {
      offset.current = next;
      wrap.style.transform = `translate3d(0, ${-next}px, 0)`;
    }
  }, []);

  const hasResults = seriesCards.length > 0 || movieCards.length > 0;

  return (
    <div className="absolute inset-0 overflow-hidden">
      <FocusScope id="content" index={1} orientation="horizontal" as="none">
        <div className="absolute top-[96px]" style={{ left: 'var(--content-x)' }}>
          <FocusScope id="search-keyboard" index={0} orientation="vertical" as="none">
            <Keyboard value={query} onChange={setQuery} autoFocus placeholder="Buscar película o serie" />
          </FocusScope>
        </div>

        <div className="absolute top-[96px] bottom-0 overflow-hidden" style={{ left: RESULTS_X, right: 0 }}>
          <FocusScope index={1} orientation="vertical" onChildFocus={onResultsFocus} as="none">
            <div ref={resultsRef} className="tv-content" style={{ transform: 'translate3d(0,0,0)' }}>
              {seriesCards.length > 0 && (
                <Row index={0} title="Series" inset={0}>
                  {seriesCards.map(({ g, f }, i) => (
                    <PosterCard key={f.key} index={i} item={f} onSelect={() => openSeries(g, f)} />
                  ))}
                </Row>
              )}
              {movieCards.length > 0 && (
                <Row index={1} title="Películas" inset={0}>
                  {movieCards.map(({ key, items, f }, i) => (
                    <PosterCard key={key} index={i} item={f} onSelect={() => openMovie(items, f)} />
                  ))}
                </Row>
              )}
            </div>
          </FocusScope>
          {!hasResults && (
            <div className="absolute top-[60px] left-0 w-[900px] pointer-events-none">
              {query.trim().length < 2 ? (
                <>
                  <p className="text-h1 font-bold text-tv-text2">¿Qué quieres ver?</p>
                  <p className="text-body text-tv-text3 mt-3 max-w-[700px] leading-relaxed">
                    Escribe con el mando. Los resultados aparecen aquí según tecleas, agrupados en series y películas.
                  </p>
                </>
              ) : searching ? (
                <p className="text-lead text-tv-text2">Buscando "{query.trim()}"…</p>
              ) : (
                <>
                  <p className="text-h1 font-bold text-tv-text2">Nada con "{query.trim()}"</p>
                  <p className="text-body text-tv-text3 mt-3">Prueba con menos palabras o con el título original.</p>
                </>
              )}
            </div>
          )}
        </div>
      </FocusScope>

      {detail && <TitleDetail input={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
