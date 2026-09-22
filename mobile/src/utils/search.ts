import { cleanTitle } from './text';
import type { SearchResult } from '../types';

export interface SearchSeriesGroup {
  groupKey: string;
  seriesName: string;
  season: number;
  episode: number;
  episodes: SearchResult[];
  channelId?: number;
  tmdbId?: number;
  tmdbType?: string;
}

export interface GroupedSearch {
  groups: SearchSeriesGroup[];
  movieGroups: Map<string, SearchResult[]>;
  singles: SearchResult[];
}

const EPISODE_RE = /(\d{1,2})x(\d{2,3})|[sS](\d{1,2})\s*[.\s]?[eE](\d{1,3})|\[[Ss]\s*(\d{1,2})\s*[Ee]\s*(\d{1,3})\]/;

const trimSeps = (s: string) => s.replace(/^[\s\-–—:_.]+|[\s\-–—:_.]+$/g, '');

function seriesNameOf(fileName: string): string {
  // "Serie 1x01 - Episodio" -> "Serie"; "1x01 - Serie" -> "Serie";
  // "The Office - S04E03 - ..." -> "The Office" (sin el guion colgando).
  const m = fileName.match(EPISODE_RE);
  if (!m) return trimSeps(cleanTitle(fileName));
  const before = trimSeps(cleanTitle(fileName.slice(0, m.index)));
  if (before) return before;
  const after = fileName.slice(m.index! + m[0].length).replace(/^[\s\-–—]+/, '');
  return trimSeps(cleanTitle(after)) || trimSeps(cleanTitle(fileName));
}

/**
 * Agrupa resultados de busqueda por titulo.
 *
 * Con id de TMDB se agrupa por el (la serie es una aunque los archivos vengan
 * de canales o ripeos distintos); sin el, por el nombre de la serie que va
 * delante del "1x01". Antes se usaban las tres primeras palabras del nombre
 * limpio, que incluia el titulo del episodio, y cada capitulo salia como una
 * serie distinta.
 */
export function groupSearchResults(results: SearchResult[]): GroupedSearch {
  const groups: SearchSeriesGroup[] = [];
  const byKey = new Map<string, SearchSeriesGroup>();
  const movieGroups = new Map<string, SearchResult[]>();
  const singles: SearchResult[] = [];

  for (const r of results) {
    const m = r.file_name.match(EPISODE_RE);
    const isSeries = r.tmdb_type ? r.tmdb_type === 'tv' : (r.media_type === 'series' || !!m);

    if (isSeries) {
      const name = seriesNameOf(r.file_name);
      const key = r.tmdb_id ? `s${r.tmdb_id}` : `n:${name.toLowerCase()}`;
      let g = byKey.get(key);
      if (!g) {
        const season = parseInt(m?.[1] || m?.[3] || m?.[5] || '') || r.season || 1;
        const episode = parseInt(m?.[2] || m?.[4] || m?.[6] || '') || r.episode || 1;
        g = { groupKey: key, seriesName: r.tmdb_title || name, season, episode, episodes: [], channelId: r.channel_id, tmdbId: r.tmdb_id, tmdbType: r.tmdb_type };
        byKey.set(key, g);
        groups.push(g);
      }
      g.episodes.push(r);
      continue;
    }

    const name = cleanTitle(r.file_name);
    if (name && name.length > 1) {
      const key = r.tmdb_id ? `m${r.tmdb_id}` : name.toLowerCase();
      if (!movieGroups.has(key)) movieGroups.set(key, []);
      movieGroups.get(key)!.push(r);
    } else {
      singles.push(r);
    }
  }

  return { groups, movieGroups, singles };
}
