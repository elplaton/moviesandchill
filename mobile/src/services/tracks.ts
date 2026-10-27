import { apiFetch, getAccessToken } from './api';

export interface ExternalSubtitle {
  path: string;
  language: string;
  label: string;
  forced: boolean;
}

export interface AudioTrack {
  /** Posición entre las pistas de audio (0:a:N): es lo que se manda en `audio=`. */
  order: number;
  codec: string;
  language: string;
  language_name: string;
  title: string;
  channels: number | null;
  default: boolean;
}

export interface MediaTracks {
  audio: AudioTrack[];
  external_subtitles: ExternalSubtitle[];
  /** La pista que pone el servidor en la versión adaptada si no se le pide otra. */
  default_audio: number | null;
}

const VACIO: MediaTracks = { audio: [], external_subtitles: [], default_audio: null };

/**
 * Qué pistas trae un vídeo: las de audio, para el selector de idioma, y los
 * subtítulos sueltos (.vtt), que se le cuelgan al <video> como `<track>`.
 *
 * Los subtítulos los elige el reproductor del sistema, que trae su selector.
 * El idioma no: Chrome no implementa `audioTracks` y suena siempre la primera
 * pista, y la versión adaptada (HLS) solo lleva una, así que ni el iPhone
 * tiene a cuál cambiar. Por eso el selector de idioma lo pone `Player`.
 *
 * Si falla se devuelve vacío: el reproductor tiene que funcionar igual aunque
 * no se puedan leer.
 */
export async function fetchTracks(path: string): Promise<MediaTracks> {
  try {
    const res = await apiFetch(`/media/tracks?path=${encodeURIComponent(path)}`);
    if (!res.ok) return VACIO;
    const d = await res.json();
    return {
      audio: d.audio || [],
      external_subtitles: d.external_subtitles || [],
      default_audio: d.default_audio ?? null,
    };
  } catch {
    return VACIO;
  }
}

/** Nombre corto para el selector: «Español · 5.1» o «Inglés · Comentarios».
 *  El mismo que en la web (`frontend/src/services/tracks.ts`). */
export function audioLabel(t: AudioTrack): string {
  const extras: string[] = [];
  if (t.channels === 6) extras.push('5.1');
  else if (t.channels === 8) extras.push('7.1');
  else if (t.channels === 1) extras.push('mono');
  if (t.title) extras.unshift(t.title);
  const nombre = t.language_name || `Pista ${t.order + 1}`;
  return extras.length ? `${nombre} · ${extras.join(' · ')}` : nombre;
}

/** Las pistas de audio que el navegador deja cambiar en caliente (Safari), o
 *  null si no las expone (Chrome no implementa `audioTracks`). */
export function pistasNativas(video: HTMLVideoElement | null): { length: number; [i: number]: { enabled: boolean } } | null {
  const lista = (video as unknown as { audioTracks?: { length: number; [i: number]: { enabled: boolean } } } | null)?.audioTracks;
  return lista && lista.length > 1 ? lista : null;
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
