import { apiFetch, getAccessToken } from './api';

export interface AudioTrack {
  order: number;
  codec: string;
  language: string;
  language_name: string;
  title: string;
  channels: number | null;
  layout: string;
  default: boolean;
}

export interface ExternalSubtitle {
  path: string;
  language: string;
  label: string;
  forced: boolean;
}

export interface MediaTracks {
  ok: boolean;
  audio: AudioTrack[];
  external_subtitles: ExternalSubtitle[];
  default_audio: number | null;
}

const VACIO: MediaTracks = { ok: false, audio: [], external_subtitles: [], default_audio: null };

/** Qué pistas trae el archivo. Si falla se devuelve vacío: el reproductor
 * tiene que funcionar igual aunque no se puedan leer. */
export async function fetchTracks(path: string): Promise<MediaTracks> {
  try {
    const res = await apiFetch(`/media/tracks?path=${encodeURIComponent(path)}`);
    if (!res.ok) return VACIO;
    const d = await res.json();
    return {
      ok: !!d.ok,
      audio: d.audio || [],
      external_subtitles: d.external_subtitles || [],
      default_audio: d.default_audio ?? null,
    };
  } catch {
    return VACIO;
  }
}

export function subtitleUrl(path: string, token?: string): string {
  // Con la entrada de reproducción, que cubre el vídeo y sus subtítulos; sin
  // ella, el token de acceso, que es lo que se usaba antes.
  const t = token || getAccessToken() || '';
  return `/api/subtitle?path=${encodeURIComponent(path)}&token=${encodeURIComponent(t)}`;
}

/** Nombre corto para el selector: «Español · 5.1» o «Inglés · AC3». */
export function audioLabel(t: AudioTrack): string {
  const extras: string[] = [];
  if (t.channels === 6) extras.push('5.1');
  else if (t.channels === 8) extras.push('7.1');
  else if (t.channels === 1) extras.push('mono');
  if (t.title) extras.unshift(t.title);
  return extras.length ? `${t.language_name} · ${extras.join(' · ')}` : t.language_name;
}

/**
 * Si el navegador deja cambiar de pista de audio.
 *
 * Safari expone `video.audioTracks` y se puede cambiar en caliente. Chrome no
 * lo implementa, así que ahí suena siempre la primera pista del archivo: por
 * eso la conversión pone delante el español, para que sea la que se oiga.
 */
export function puedeCambiarAudio(video: HTMLVideoElement | null): boolean {
  const lista = (video as unknown as { audioTracks?: { length: number } })?.audioTracks;
  return !!lista && lista.length > 1;
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
