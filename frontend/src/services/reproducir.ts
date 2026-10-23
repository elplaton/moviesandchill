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
  pistas?: Pistas | null;
}

export interface Pistas {
  container?: string;
  video?: { codec?: string; bits?: number | null; apple?: boolean; height?: number } | null;
  audio?: { codec?: string }[];
  audio_apple?: boolean;
  /** El servidor puede adaptarlo al vuelo (HLS): audio a AAC y la imagen
   *  copiada o, si no es H.264/HEVC (un AVI con XviD), recodificada. */
  hls?: boolean;
  default_audio?: number | null;
}

/**
 * Como se reproduce una ruta `tg:` en este navegador: tal cual (`directo`) o
 * adaptada al vuelo por el servidor (services/hls.py). Hace falta con el audio
 * AC-3/DTS, que Chrome no decodifica (la imagen sale y el sonido no), y en
 * Safari con cualquier MKV. La version adaptada se abre con hls.js (`hlsjs`)
 * o, en Safari, con su HLS propio (`hls`).
 */
export type Modo = 'directo' | 'hls' | 'hlsjs';

export async function modoDeReproduccion(path: string): Promise<Modo> {
  if (!path.startsWith('tg:')) return 'directo';
  try {
    const res = await apiFetch(`/media/tracks?path=${encodeURIComponent(path)}`);
    if (!res.ok) return 'directo';
    const p: Pistas = await res.json();
    if (!p.hls || abreTalCual(p)) return 'directo';
    return await comoAbrirHls();
  } catch {
    return 'directo';
  }
}

/**
 * En Safari, con su HLS: es el de verdad y el unico que viaja por AirPlay
 * (hls.js reproduce desde un `blob:` que el Apple TV no puede pedir). En el
 * resto, hls.js antes que el HLS propio que algunos Chrome empiezan a traer,
 * que con fMP4 aun no es de fiar.
 */
async function comoAbrirHls(): Promise<Modo> {
  const nativo = sabeHls();
  if (nativo && esSafari()) return 'hls';
  try {
    const { default: Hls } = await import('hls.js');
    if (Hls.isSupported()) return 'hlsjs';
  } catch { /* sin hls.js se intenta lo siguiente */ }
  return nativo ? 'hls' : 'directo';
}

function sabeHls(): boolean {
  try {
    return !!document.createElement('video').canPlayType('application/vnd.apple.mpegurl');
  } catch {
    return false;
  }
}

function esSafari(): boolean {
  const ua = navigator.userAgent;
  return /Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS|Android/.test(ua);
}

/** Audio que ningun navegador decodifica: se veria la imagen sin sonido. */
const SIN_SONIDO = /^(ac3|eac3|dts|truehd)$/i;
/** Contenedores e imagen que abre un navegador. Un AVI no lo abre ninguno, y
 *  XviD/DivX (`mpeg4`), que es lo que llevan casi todos, tampoco. */
const CONTENEDOR_WEB = /matroska|webm|mp4|mov/i;
const VIDEO_WEB = /^(h264|hevc|vp8|vp9|av1)$/i;

/** Si el navegador abre el archivo sin adaptarlo: MKV/MP4/WebM (Safari, solo
 *  MP4) con imagen que entienda y sin audio AC-3/DTS. Del audio cuenta la
 *  pista que va a sonar, no que haya alguna buena: Chrome no deja elegir y
 *  suena la primera (o la marcada por defecto), y con el castellano en AC-3 y
 *  el ingles en AAC la pelicula se veia muda. */
function abreTalCual(p: Pistas): boolean {
  if (!(esSafari() ? /mp4|mov/i : CONTENEDOR_WEB).test(p.container || '')) return false;
  if (p.video?.codec && !VIDEO_WEB.test(p.video.codec)) return false;
  const audio = p.audio || [];
  const suenan = [audio[0], audio[p.default_audio ?? 0]].filter(Boolean);
  return !suenan.some(a => SIN_SONIDO.test(a.codec || ''));
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

/**
 * Por que este navegador no puede ver el archivo sin descargarlo, o '' si
 * puede. Lo que no abre tal cual lo adapta el servidor al vuelo (`hls`); lo
 * que ni eso (un AVI en 1080p) se dice antes de abrir un reproductor negro.
 */
export function motivoNoSeVe(r: Reproduccion): string {
  const p = r.pistas;
  if (!p || p.hls || abreTalCual(p)) return '';
  if (p.video?.codec && !VIDEO_WEB.test(p.video.codec) || !CONTENEDOR_WEB.test(p.container || '')) {
    return 'este formato no se puede ver sin descargar: descárgalo y se convierte';
  }
  return '';
}

/** Audio que Chrome no sabe decodificar y que el servidor no puede adaptar
 *  al vuelo: el video se veria sin sonido. */
export function audioQueNoSuena(r: Reproduccion): boolean {
  if (r.pistas?.hls) return false;
  const audio = r.pistas?.audio || [];
  return audio.length > 0 && audio.every(a => SIN_SONIDO.test(a.codec || ''));
}
