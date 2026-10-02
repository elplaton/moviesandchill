import { apiFetch, getApiBase } from './api';
import { getAccessToken } from './api';

export interface AudioTrack {
  order: number;
  language: string;
  language_name: string;
  title: string;
  channels: number | null;
}

export interface ExternalSubtitle {
  path: string;
  language: string;
  label: string;
}

/**
 * La pista de video, solo para saber si el aparato puede con ella.
 *
 * `ps4` lo decide el servidor (`video_apto_ps4()`): el navegador de la consola
 * solo lee H.264 de 8 bits, y con cualquier otra cosa reproduce el audio y
 * deja la imagen en negro sin dar ningun error. Es el mismo fallo que ya se
 * diagnostico a ciegas con AirPlay, asi que aqui se avisa antes de empezar.
 */
export interface VideoInfo {
  codec: string;
  width: number | null;
  height: number | null;
  ps4: boolean;
  ps4_motivo: string;
  apple: boolean;
  apple_motivo: string;
}

export interface MediaTracks {
  audio: AudioTrack[];
  subtitles: ExternalSubtitle[];
  defaultAudio: number;
  video: VideoInfo | null;
}

const VACIO: MediaTracks = { audio: [], subtitles: [], defaultAudio: 0, video: null };

export async function fetchTracks(path: string): Promise<MediaTracks> {
  try {
    const res = await apiFetch(`/media/tracks?path=${encodeURIComponent(path)}`);
    if (!res.ok) return VACIO;
    const d = await res.json();
    return {
      audio: d.audio || [],
      subtitles: d.external_subtitles || [],
      defaultAudio: d.default_audio ?? 0,
      video: d.video || null,
    };
  } catch {
    return VACIO;
  }
}

export function subtitleUrl(path: string): string {
  const base = getApiBase();
  return `${base}/subtitle?path=${encodeURIComponent(path)}&token=${encodeURIComponent(getAccessToken() || '')}`;
}

export function audioLabel(t: AudioTrack): string {
  const extra = t.channels === 6 ? ' · 5.1' : t.channels === 8 ? ' · 7.1' : '';
  return (t.title ? `${t.language_name} · ${t.title}` : t.language_name) + extra;
}
