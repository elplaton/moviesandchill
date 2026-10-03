import { apiFetch } from './api';
import type { TMDBMetadata } from '../types';

const cache = new Map<string, TMDBMetadata>();

/**
 * Fichas de TMDB a partir de nombres de carpeta, en una sola peticion.
 *
 * Lo que hay en disco solo tiene nombre de archivo: para enseñar la caratula
 * en Descargas hay que preguntar por el titulo. Se cachea en memoria porque
 * la lista se recarga cada vez que termina una descarga.
 */
export async function fetchMetadataBatch(names: string[]): Promise<Map<string, TMDBMetadata>> {
  const unique = [...new Set(names.filter(n => n && n.length > 1))];
  const faltan = unique.filter(n => !cache.has(n));

  if (faltan.length > 0) {
    try {
      const res = await apiFetch('/metadata/batch', { method: 'POST', body: JSON.stringify({ names: faltan }) });
      const data = await res.json();
      for (const [key, info] of Object.entries(data.metadata || {})) cache.set(key, info as TMDBMetadata);
    } catch { /* sin conexion: se usa el nombre a secas */ }
    // Lo que TMDB no conoce tambien se cachea, o se vuelve a preguntar siempre.
    for (const n of faltan) if (!cache.has(n)) cache.set(n, { title: n });
  }

  return cache;
}
