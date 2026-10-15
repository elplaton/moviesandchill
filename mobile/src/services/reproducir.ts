import { apiFetch } from './api';

/**
 * Ver sin descargar: el servidor lee el archivo de Telegram mientras se ve
 * (como Telegram Desktop). Antes de abrir el reproductor se le pregunta si se
 * puede: lo comprimido de verdad hay que descargarlo. La respuesta trae una
 * `path` (`tg:<canal>:<mensaje>`) que el reproductor abre como cualquier otra.
 */
export interface Reproduccion {
  modo: 'ver' | 'descargar';
  motivo: string;
  path: string | null;
  pistas?: {
    container?: string;
    video?: { codec?: string; bits?: number | null; apple?: boolean } | null;
    audio?: { codec?: string }[];
    audio_apple?: boolean;
  } | null;
}

export async function comprobarReproduccion(channelId: number | undefined, messageId: number): Promise<Reproduccion> {
  try {
    const res = await apiFetch(`/reproducir?channel_id=${channelId ?? 0}&message_id=${messageId}`);
    if (!res.ok) return { modo: 'descargar', motivo: 'el servidor no ha podido comprobarlo', path: null };
    return await res.json();
  } catch {
    return { modo: 'descargar', motivo: 'no se ha podido contactar con el servidor', path: null };
  }
}

/** Audio que Chrome no sabe decodificar: el video se veria sin sonido. */
export function audioQueNoSuena(r: Reproduccion): boolean {
  const audio = r.pistas?.audio || [];
  return audio.length > 0 && audio.every(a => /^(ac3|eac3|dts|truehd)$/i.test(a.codec || ''));
}

/** iPhone, iPad o iPod (el iPad se hace pasar por Mac, pero tiene pantalla tactil). */
export function esIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/**
 * Por que no se puede ver en este aparato sin descargar, o '' si se puede.
 * El reproductor del iPhone solo abre MP4/MOV con video que entienda y audio
 * AAC; el resto se convierte al descargar, y al vuelo aun no se adapta.
 */
export function motivoNoSeVe(r: Reproduccion): string {
  if (r.modo !== 'ver' || !r.path) return r.motivo || 'hay que descargarla';
  if (!esIOS()) return '';
  const p = r.pistas;
  if (!p) return '';
  if (!/mp4|mov/i.test(p.container || '')) return 'el iPhone no abre este formato (MKV/AVI): descárgala y se convierte';
  if (p.video && p.video.apple === false) return 'el vídeo no es compatible con el iPhone: descárgala y se convierte';
  if (p.audio_apple === false) return 'el audio (AC-3/DTS) no suena en el iPhone: descárgala y se convierte';
  return '';
}
