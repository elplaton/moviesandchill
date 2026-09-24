import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Shell from '../components/Shell';
import Card from '../components/Card';
import TitleSheet, { type SheetInput } from '../components/TitleSheet';
import Button from '../components/ui/Button';
import { apiFetch } from '../services/api';
import { fetchMediaFiles } from '../services/media';
import { groupSearchResults, type SearchSeriesGroup } from '../utils/search';
import { cleanTitle } from '../utils/text';
import { IconInfo, IconSearch } from '../components/ui/Icon';
import type { SearchResult, TMDBMetadata } from '../types';

const metaOf = (r: SearchResult): TMDBMetadata => ({
  title: r.tmdb_title || cleanTitle(r.file_name), year: r.tmdb_year, rating: r.tmdb_rating,
  poster: r.tmdb_poster, backdrop: r.tmdb_backdrop, overview: r.tmdb_overview, genres: r.tmdb_genres,
});

/**
 * Resultados de búsqueda en rejilla.
 *
 * Antes la búsqueda vivía dentro de la portada y sustituía los carriles por
 * otros carriles; en una pantalla ancha una rejilla enseña el triple de
 * resultados y no obliga a desplazarse en horizontal para verlos.
 */
export default function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const [text, setText] = useState(q);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<SheetInput | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setText(q); }, [q]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const term = text.trim();
    if (term.length < 2) { setResults([]); setBusy(false); return; }
    setBusy(true);
    timer.current = setTimeout(async () => {
      try {
        const d = await (await apiFetch('/search', { method: 'POST', body: JSON.stringify({ query: term, page_size: 100 }) })).json();
        setResults(d.results || []);
        setParams(term ? { q: term } : {}, { replace: true });
      } catch { /* sin resultados */ } finally { setBusy(false); }
    }, 320);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = useMemo(() => groupSearchResults(results), [results]);

  const openSeries = async (g: SearchSeriesGroup) => {
    const meta = { ...metaOf(g.episodes[0]), title: g.seriesName };
    if (g.tmdbId) {
      try {
        const { results: files } = await fetchMediaFiles(g.tmdbId, 'tv');
        if (files.length) { setSheet({ kind: 'series', tmdbId: g.tmdbId, meta, files }); return; }
      } catch { /* se usa lo encontrado */ }
    }
    setSheet({ kind: 'series', tmdbId: g.tmdbId, meta, files: g.episodes });
  };

  const openMovie = async (items: SearchResult[]) => {
    const meta = metaOf(items[0]);
    const id = items[0].tmdb_id;
    if (id) {
      try {
        const { results: files } = await fetchMediaFiles(id, 'movie');
        if (files.length) { setSheet({ kind: 'movie', tmdbId: id, meta, files }); return; }
      } catch { /* se usa lo encontrado */ }
    }
    setSheet({ kind: 'movie', tmdbId: id, meta, files: items });
  };

  const grid = 'grid gap-x-[var(--row-gap)] gap-y-7 [grid-template-columns:repeat(auto-fill,minmax(var(--card-w),1fr))]';

  return (
    <Shell>
      <div className="px-gutter">
        <div className="relative mb-8 max-w-[560px]">
          <span className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-nf-faint"><IconSearch /></span>
          <input ref={inputRef} value={text} onChange={e => setText(e.target.value)} placeholder="Busca una película o serie"
            className="h-13 w-full rounded border border-nf-line bg-nf-surface py-3.5 pl-12 pr-4 text-md outline-none focus:border-white/40" />
        </div>

        {text.trim().length < 2 && (
          <p className="text-base text-nf-faint">Escribe al menos dos letras. Los resultados se agrupan en series y películas.</p>
        )}
        {busy && results.length === 0 && text.trim().length >= 2 && <p className="text-base text-nf-faint">Buscando…</p>}

        {grouped.groups.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-4 text-lg font-semibold">Series</h2>
            <div className={grid}>
              {grouped.groups.map(g => (
                <Card key={g.groupKey} title={g.seriesName} poster={g.episodes[0].tmdb_poster} rating={g.episodes[0].tmdb_rating}
                  meta={`${g.episodes.length} episodios encontrados`} onOpen={() => openSeries(g)}
                  actions={<Button variant="light" size="sm" icon={<IconInfo />} onClick={() => openSeries(g)}>Ver episodios</Button>} />
              ))}
            </div>
          </section>
        )}

        {grouped.movieGroups.size > 0 && (
          <section className="mb-10">
            <h2 className="mb-4 text-lg font-semibold">Películas</h2>
            <div className={grid}>
              {[...grouped.movieGroups.entries()].map(([key, items]) => (
                <Card key={key} title={items[0].tmdb_title || cleanTitle(items[0].file_name)} poster={items[0].tmdb_poster}
                  rating={items[0].tmdb_rating} meta={`${items.length} ${items.length === 1 ? 'archivo' : 'archivos'}`}
                  onOpen={() => openMovie(items)}
                  actions={<Button variant="light" size="sm" icon={<IconInfo />} onClick={() => openMovie(items)}>Ver detalles</Button>} />
              ))}
            </div>
          </section>
        )}

        {!busy && text.trim().length >= 2 && results.length === 0 && (
          <div>
            <p className="text-lg text-nf-dim">Nada con «{text.trim()}».</p>
            <p className="mt-1 text-base text-nf-faint">Prueba con menos palabras o con el título original.</p>
          </div>
        )}
      </div>

      <div className="h-16" />
      {sheet && <TitleSheet input={sheet} onClose={() => setSheet(null)} />}
    </Shell>
  );
}
