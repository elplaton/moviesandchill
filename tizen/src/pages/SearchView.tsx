import { useState } from 'react';
import MovieRow from '../components/MovieRow';
import MovieCard from '../components/MovieCard';
import OnScreenKeyboard from '../components/OnScreenKeyboard';
import { FocusScope, useFocusItem } from '../focus/react';
import { cleanTitle } from '../utils/text';
import type { SearchResult, TMDBMetadata } from '../types';

interface SearchGroup {
  groupKey?: string;
  tmdbId?: number;
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
  /** Posicion de todo el bloque dentro de la pantalla. */
  index?: number;
}

function SearchField({ value, onOpen }: { value: string; onOpen: () => void }) {
  // onEnter es lo que ejecuta el mando; onClick solo cubre el puntero. Sin el
  // primero, el teclado en pantalla no se abria nunca desde el mando.
  const { ref } = useFocusItem<HTMLDivElement>({
    focusKey: 'search-input', index: 0, onEnter: onOpen,
  });
  return (
    <div
      ref={ref}
      onClick={onOpen}
      className="tv-focusable relative flex-1 min-w-[280px] max-w-xl rounded-xl bg-white/10 border border-white/10 cursor-pointer"
    >
      <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <div className="w-full pl-11 pr-5 py-3 text-sm">
        {value
          ? <span className="text-white">{value}</span>
          : <span className="text-gray-500">Buscar pelicula o serie...</span>}
      </div>
    </div>
  );
}

export default function SearchView({
  searching, searchGroups, searchSingles, movieGroups,
  downloadStates, onSearch, onDownload, onCancelBatch,
  onOpenSeries, onOpenMovie, tmdbFromResult, streamUrl,
  onQueryChange, alwaysShowBar, index,
}: Props) {
  const [query, setQuery] = useState('');
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const handleChange = (next: string) => {
    setQuery(next);
    // Escribir con el mando es lento de por si, asi que cada tecla puede
    // disparar la busqueda sin saturar el backend.
    if (onQueryChange) onQueryChange(next);
    else onSearch(next);
  };

  const hasResults = searchGroups.length > 0 || movieGroups.size > 0 || searchSingles.length > 0;

  // Las filas se numeran segun cuales se estan mostrando: el orden de
  // navegacion tiene que ser explicito, no depender del orden de montaje.
  let rowIndex = 0;
  const nextRow = () => ++rowIndex;

  return (
    <FocusScope orientation="vertical" index={index} as="none">
      {(alwaysShowBar || hasResults) && (
        <div className="px-6 md:px-14 mb-8">
          <div className="flex gap-3 items-center flex-wrap">
            <SearchField value={query} onOpen={() => setKeyboardOpen(true)} />
          </div>
        </div>
      )}

      {searchGroups.length > 0 && (
        <MovieRow index={nextRow()} title={searching ? 'Buscando...' : 'Series encontradas'}>
          {searchGroups.map((g, i) => {
            const meta = tmdbFromResult(g.episodes[0]);
            return (
              <MovieCard key={g.groupKey || g.seriesName} index={i} name={g.seriesName}
                subtitle={`${g.episodes.length} episodios`}
                posterUrl={meta.poster} year={meta.year} rating={meta.rating}
                onClick={() => onOpenSeries(g)} hoverLabel="Ver episodios" actions="click" />
            );
          })}
        </MovieRow>
      )}

      {movieGroups.size > 0 && (
        <MovieRow index={nextRow()} title="Peliculas encontradas">
          {Array.from(movieGroups.entries()).map(([groupKey, items], i) => {
            const name = items[0].tmdb_title || cleanTitle(items[0].file_name);
            const meta = tmdbFromResult(items[0]);
            return (
              <MovieCard key={groupKey} index={i} name={name}
                subtitle={items.length === 1 ? '1 archivo' : `${items.length} archivos`}
                posterUrl={meta.poster} year={meta.year} rating={meta.rating}
                onClick={() => onOpenMovie(name, meta, items)}
                actions="click" />
            );
          })}
        </MovieRow>
      )}

      {searchSingles.length > 0 && (
        <MovieRow index={nextRow()} title={searchGroups.length > 0 || movieGroups.size > 0 ? 'Otros resultados' : 'Resultados'}>
          {searchSingles.map((r, i) => {
            const meta = tmdbFromResult(r);
            return (
              <MovieCard key={r.id} index={i} name={r.file_name} subtitle={r.channel_name} size={r.size_str}
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

      {keyboardOpen && (
        <OnScreenKeyboard
          value={query}
          onChange={handleChange}
          onClose={() => setKeyboardOpen(false)}
        />
      )}
    </FocusScope>
  );
}
