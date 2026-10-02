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

export function subtitleUrl(path: string, token?: string): string {
  // Con la entrada de reproducción, que cubre el vídeo y sus subtítulos; sin
  // ella, el token de acceso, que es lo que se usaba antes.
  const t = token || getAccessToken() || '';
  return `/api/subtitle?path=${encodeURIComponent(path)}&token=${encodeURIComponent(t)}`;
}

/**
 * Entrada de reproducción para un archivo.
 *
 * La URL del vídeo lleva el token dentro y la lee alguien que no puede
 * renovarlo: el `<video>`, o un Apple TV por AirPlay. Con el token de acceso
 * (una hora de vida) las películas largas se cortaban a mitad. La entrada
 * dura horas pero solo vale para este archivo.
 *
 * Si falla se devuelve el token de acceso, que es lo que se usaba antes: peor
 * para una película larga, pero mejor que no reproducir nada.
 */
export async function streamTicket(path: string): Promise<string> {
  try {
    const res = await apiFetch(`/stream/ticket?path=${encodeURIComponent(path)}`);
    if (res.ok) {
      const d = await res.json();
      if (d.token) return d.token as string;
    }
  } catch { /* se cae al token de acceso */ }
  return getAccessToken() || '';
}
