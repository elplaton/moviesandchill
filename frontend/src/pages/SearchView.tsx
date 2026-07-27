import { useRef } from 'react';
import MovieRow from '../components/MovieRow';
import MovieCard from '../components/MovieCard';
import { cleanTitle } from '../utils/text';
import type { SearchResult, TMDBMetadata } from '../types';

interface SearchGroup {
  groupKey?: string;
  seriesName: string;
  season: number;
  episodes: SearchResult[];
  channelId?: number;
}

interface Props {
  searching: boolean;
  searchGroups: SearchGroup[];
  searchSingles: SearchResult[];
  movieGroups: Map<string, SearchResult[]>;
  downloadStates: Map<number, import('../types').DownloadState>;
  onSearch: (query: string) => void;
  onDownload: (msgId: number, channelId?: number) => void;
  onCancelBatch: (batchId: string) => void;
  onOpenSeries: (group: SearchGroup) => void;
  onOpenMovie: (title: string, metadata: TMDBMetadata, results: SearchResult[]) => void;
  tmdbFromResult: (r: SearchResult) => TMDBMetadata;
  streamUrl: (path: string) => string;
  onQueryChange?: (query: string) => void;
  alwaysShowBar?: boolean;
}

const DEBOUNCE_MS = 300;

export default function SearchView({
  searching, searchGroups, searchSingles, movieGroups,
  downloadStates, onSearch, onDownload, onCancelBatch,
  onOpenSeries, onOpenMovie, tmdbFromResult, streamUrl,
  onQueryChange, alwaysShowBar,
}: Props) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (value: string) => {
    if (onQueryChange) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => onQueryChange(value), DEBOUNCE_MS);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (timerRef.current) clearTimeout(timerRef.current);
      onSearch((e.target as HTMLInputElement).value);
    }
  };

  const hasResults = searchGroups.length > 0 || movieGroups.size > 0 || searchSingles.length > 0;

  const searchBar = (
    <div className="relative flex-1 min-w-[280px] max-w-xl">
      <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        ref={inputRef}
        placeholder="Buscar pelicula o serie..."
        className="w-full bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl pl-11 pr-5 py-3 text-white text-sm outline-none focus:border-white/25 focus:bg-white/8 transition-all duration-300 placeholder-gray-500"
        onChange={onQueryChange ? (e) => handleChange(e.target.value) : undefined}
        onKeyDown={onQueryChange ? handleKeyDown : (e) => { if (e.key === 'Enter') onSearch((e.target as HTMLInputElement).value); }}
      />
    </div>
  );

  return (
    <>
      {(alwaysShowBar || hasResults) && (
        <div className="px-6 md:px-14 mb-8">
          <div className="flex gap-3 items-center flex-wrap">
            {searchBar}
          </div>
        </div>
      )}

      {searchGroups.length > 0 && (
        <MovieRow title={searching ? 'Buscando...' : 'Series encontradas'}>
          {searchGroups.map(g => {
            const meta = tmdbFromResult(g.episodes[0]);
            return (
              <MovieCard key={g.groupKey || g.seriesName} name={g.groupKey || g.seriesName}
                subtitle={`${g.episodes.length} episodios`}
                posterUrl={meta.poster} year={meta.year} rating={meta.rating}
                onClick={() => onOpenSeries(g)} hoverLabel="Ver episodios" actions="click" />
            );
          })}
        </MovieRow>
      )}

      {movieGroups.size > 0 && (
        <MovieRow title="Peliculas encontradas">
          {Array.from(movieGroups.entries()).map(([rawName, items]) => {
            const key = cleanTitle(rawName);
            const meta = tmdbFromResult(items[0]);
            return (
              <MovieCard key={key} name={key}
                subtitle={`${items.length} versiones`}
                posterUrl={meta.poster} year={meta.year} rating={meta.rating}
                onClick={() => onOpenMovie(key, meta, items)}
                actions="click" />
            );
          })}
        </MovieRow>
      )}

      {searchSingles.length > 0 && (
        <MovieRow title={searchGroups.length > 0 || movieGroups.size > 0 ? 'Otros resultados' : 'Resultados'}>
          {searchSingles.map(r => {
            const meta = tmdbFromResult(r);
            return (
              <MovieCard key={r.id} name={r.file_name} subtitle={r.channel_name} size={r.size_str}
                posterUrl={meta.poster} year={meta.year} rating={meta.rating}
                onPlay={r.downloaded ? () => window.open(streamUrl(''), '_blank') : undefined}
                onDownload={r.downloaded ? undefined : () => onDownload(r.id, r.channel_id)}
                onCancelDownload={() => onCancelBatch(downloadStates.get(r.id)?.batchId || '')}
                downloadState={downloadStates.get(r.id)}
                downloaded={r.downloaded} actions={r.downloaded ? 'play' : 'download'} />
            );
          })}
        </MovieRow>
      )}

      {searching && !hasResults && (
        <div className="px-6 md:px-14 py-8 text-center text-gray-500">Buscando...</div>
      )}
    </>
  );
}
