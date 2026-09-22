import { apiFetch } from './api';
import type { SearchResult, SeriesEpisode, TMDBMetadata } from '../types';

export interface MediaFiles {
  tmdb: (TMDBMetadata & { tmdb_id: number; media_type: string }) | null;
  results: SearchResult[];
}

/**
 * Todos los archivos de un titulo, por su id de TMDB.
 *
 * Antes el detalle buscaba por texto con el titulo en español de TMDB y en
 * dos de cada tres series no encontraba nada (el archivo se llama "How I Met
 * Your Mother 1x01" y TMDB dice "Cómo conocí a vuestra madre").
 */
export async function fetchMediaFiles(tmdbId: number, mediaType: 'movie' | 'series' | 'tv'): Promise<MediaFiles> {
  // El tipo es obligatorio: los ids de TMDB se repiten entre peliculas y series.
  const type = mediaType === 'series' ? 'tv' : mediaType;
  const res = await apiFetch(`/media/${tmdbId}/files?media_type=${type}`);
  const data = await res.json();
  return { tmdb: data.tmdb || null, results: data.results || [] };
}

export function toEpisodes(results: SearchResult[]): SeriesEpisode[] {
  return results.map(r => ({
    name: r.file_name, size: r.size_str, path: '', message_id: r.id, channel_id: r.channel_id,
  }));
}
