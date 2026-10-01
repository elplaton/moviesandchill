import { apiFetch, getAccessToken } from './api';

export interface ExternalSubtitle {
  path: string;
  language: string;
  label: string;
  forced: boolean;
}

/**
 * Subtítulos sueltos (.vtt) de un vídeo.
 *
 * En el móvil no hace falta más: el reproductor es el nativo del sistema y
 * trae su propio selector de subtítulos y de idioma, así que basta con
 * colgarle los `<track>` y deja que el teléfono ponga la interfaz.
 */
export async function fetchSubtitles(path: string): Promise<ExternalSubtitle[]> {
  try {
    const res = await apiFetch(`/media/tracks?path=${encodeURIComponent(path)}`);
    if (!res.ok) return [];
    const d = await res.json();
    return d.external_subtitles || [];
  } catch {
    return [];
  }
}

export function subtitleUrl(path: string): string {
  return `/api/subtitle?path=${encodeURIComponent(path)}&token=${encodeURIComponent(getAccessToken() || '')}`;
}
