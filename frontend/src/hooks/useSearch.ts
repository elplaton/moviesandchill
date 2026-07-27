import { useState, useCallback, useRef } from 'react';
import { apiFetch } from '../services/api';
import { cleanTitle, parseTitle } from '../utils/text';
import type { SearchResult, SeriesEpisode } from '../types';

interface SearchGroup {
  seriesName: string;
  season: number;
  episodes: SearchResult[];
  channelId?: number;
}

export function useSearch() {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchGroups, setSearchGroups] = useState<SearchGroup[]>([]);
  const [searchSingles, setSearchSingles] = useState<SearchResult[]>([]);
  const [movieGroups, setMovieGroups] = useState<Map<string, SearchResult[]>>(new Map());
  const [searching, setSearching] = useState(false);
  const lastResultsRef = useRef<{ groups: SearchGroup[]; singles: SearchResult[]; movieGroups: Map<string, SearchResult[]> }>({ groups: [], singles: [], movieGroups: new Map() });

  const doSearch = useCallback(async (query: string) => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await apiFetch('/search', {
        method: 'POST',
        body: JSON.stringify({ query: query.trim(), page_size: 50, offset_id: 0, sort_asc: false }),
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
        if (items.length > 1) { movieGrps.set(items[0].file_name, items); }
        else { singles.push(items[0]); }
      }
      singles.push(...trueSingles);
      setMovieGroups(movieGrps);
      setSearchSingles(singles);
      lastResultsRef.current = { groups, singles, movieGroups: movieGrps };
    } catch {}
    setSearching(false);
  }, []);

  return { results, searchGroups, searchSingles, movieGroups, searching, doSearch, lastResultsRef };
}
