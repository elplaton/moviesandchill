import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../services/api';
import { groupSearchResults } from '../utils/search';
import { cleanTitle } from '../utils/text';
import { ISearch } from '../components/Icons';
import type { SearchResult } from '../types';

function Result({ to, poster, title, meta }: { to: string; poster?: string; title: string; meta: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 px-4 py-2 active:bg-white/5">
      <div className="w-[52px] h-[78px] rounded-md bg-nf-card overflow-hidden shrink-0">{poster && <img src={poster} alt="" className="w-full h-full object-cover" />}</div>
      <div className="min-w-0"><p className="text-[15px] font-medium truncate">{title}</p><p className="text-[12px] text-nf-text3 truncate">{meta}</p></div>
    </Link>
  );
}

/** Búsqueda con el teclado del sistema; resultados según se escribe. */
export default function Search() {
  const [q, setQ] = useState(() => sessionStorage.getItem('mc.q') || '');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    sessionStorage.setItem('mc.q', q);
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults([]); setBusy(false); return; }
    setBusy(true);
    timer.current = setTimeout(async () => {
      try { const d = await (await apiFetch('/search', { method: 'POST', body: JSON.stringify({ query: q.trim(), page_size: 100 }) })).json(); setResults(d.results || []); }
      catch {} finally { setBusy(false); }
    }, 350);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  const g = useMemo(() => groupSearchResults(results), [results]);
  const seriesItems = g.groups.map(s => {
    const f = s.episodes[0];
    const to = s.tmdbId ? `/t/series/${s.tmdbId}` : `/t/series/0?q=${encodeURIComponent(s.seriesName)}`;
    return <Result key={s.groupKey} to={to} poster={f.tmdb_poster} title={s.seriesName} meta={`${s.episodes.length} episodios encontrados${f.tmdb_year ? ` · ${f.tmdb_year}` : ''}`} />;
  });
  const movieItems = [...g.movieGroups.entries()].map(([k, items]) => {
    const f = items[0]; const title = f.tmdb_title || cleanTitle(f.file_name);
    const to = f.tmdb_id ? `/t/movie/${f.tmdb_id}` : `/t/movie/0?q=${encodeURIComponent(title)}`;
    return <Result key={k} to={to} poster={f.tmdb_poster} title={title} meta={`${items.length} ${items.length === 1 ? 'archivo' : 'archivos'}${f.tmdb_year ? ` · ${f.tmdb_year}` : ''}`} />;
  });

  return (
    <div>
      <div className="sticky top-0 z-30 bg-nf-bg/95 backdrop-blur px-4 pb-3" style={{ paddingTop: 'calc(var(--safe-t) + 12px)' }}>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-nf-text3"><ISearch /></span>
          <input ref={inputRef} type="search" enterKeyHint="search" autoCapitalize="none" autoCorrect="off" placeholder="Película o serie"
            value={q} onChange={e => setQ(e.target.value)}
            className="w-full h-12 rounded-xl bg-white/10 pl-11 pr-4 text-[16px] outline-none focus:bg-white/15" />
        </div>
      </div>
      {q.trim().length < 2 && <p className="px-4 pt-6 text-nf-text3 text-[14px]">Escribe al menos dos letras. Los resultados se agrupan en series y películas.</p>}
      {busy && results.length === 0 && <p className="px-4 pt-6 text-nf-text3 text-[14px]">Buscando…</p>}
      {seriesItems.length > 0 && <><h2 className="px-4 pt-3 pb-1 text-[13px] font-semibold text-nf-text2">Series</h2>{seriesItems}</>}
      {movieItems.length > 0 && <><h2 className="px-4 pt-3 pb-1 text-[13px] font-semibold text-nf-text2">Películas</h2>{movieItems}</>}
      {!busy && q.trim().length >= 2 && results.length === 0 && <p className="px-4 pt-6 text-nf-text3 text-[14px]">Nada con "{q.trim()}".</p>}
    </div>
  );
}
