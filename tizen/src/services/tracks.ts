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

export interface MediaTracks {
  audio: AudioTrack[];
  subtitles: ExternalSubtitle[];
  defaultAudio: number;
}

const VACIO: MediaTracks = { audio: [], subtitles: [], defaultAudio: 0 };

export async function fetchTracks(path: string): Promise<MediaTracks> {
  try {
    const res = await apiFetch(`/media/tracks?path=${encodeURIComponent(path)}`);
    if (!res.ok) return VACIO;
    const d = await res.json();
    return {
      audio: d.audio || [],
      subtitles: d.external_subtitles || [],
      defaultAudio: d.default_audio ?? 0,
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
