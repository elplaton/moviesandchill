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
  video?: { codec?: string; bits?: number | null; apple?: boolean } | null;
  audio?: { codec?: string }[];
  audio_apple?: boolean;
  /** El servidor puede adaptarlo al vuelo (HLS): imagen copiada, audio a AAC. */
  hls?: boolean;
  default_audio?: number | null;
}

/** Si el reproductor del iPhone abre el archivo tal cual. */
export function nativoEnIOS(p: Pistas | null | undefined): boolean {
  if (!p) return true;
  return /mp4|mov/i.test(p.container || '') && p.video?.apple !== false && p.audio_apple !== false;
}

/**
 * Como se reproduce una ruta `tg:` en este aparato: tal cual (`directo`) o
 * adaptada al vuelo por el servidor (services/hls.py), que es lo que hace falta
 * en el iPhone con un MKV y en cualquier navegador con audio AC-3/DTS. La
 * version adaptada se abre con el HLS del propio navegador (`hls`, el iPhone)
 * o con hls.js (`hlsjs`, Chrome de Android, que no trae HLS propio).
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
 * Con que se abre la version adaptada. En Apple, con su HLS: es el de verdad y
 * el unico que viaja por AirPlay (hls.js reproduce desde un `blob:` que el
 * Apple TV no puede pedir). En el resto, hls.js antes que el HLS propio que
 * algunos Chrome empiezan a traer, que con fMP4 aun no es de fiar.
 */
async function comoAbrirHls(): Promise<Modo> {
  const nativo = sabeHls();
  if (nativo && (esIOS() || esSafari())) return 'hls';
  try {
    const { default: Hls } = await import('hls.js');
    if (Hls.isSupported()) return 'hlsjs';
  } catch { /* sin hls.js se intenta lo siguiente */ }
  return nativo ? 'hls' : 'directo';
}

/** Si el navegador reproduce HLS por si mismo (Safari siempre). Se pregunta
 *  al navegador, no se adivina. */
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

/** Si este aparato abre el archivo sin adaptarlo. En el iPhone, solo MP4/MOV
 *  compatibles; en el resto, casi todo menos el audio AC-3/DTS. Cuenta la
 *  pista que va a sonar, no que haya alguna buena: Chrome no deja elegir y
 *  suena la primera (o la marcada por defecto), y con el castellano en AC-3 y
 *  el ingles en AAC la pelicula se veia muda. */
function abreTalCual(p: Pistas): boolean {
  if (esIOS() || esSafari()) return nativoEnIOS(p);
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

/** Audio que Chrome no sabe decodificar: el video se veria sin sonido. */
export function audioQueNoSuena(r: Reproduccion): boolean {
  const audio = r.pistas?.audio || [];
  return audio.length > 0 && audio.every(a => SIN_SONIDO.test(a.codec || ''));
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
  // Lo que el iPhone no abre tal cual, el servidor lo adapta al vuelo.
  if (p.hls) return '';
  if (!/mp4|mov/i.test(p.container || '')) return 'el iPhone no abre este formato (MKV/AVI): descárgala y se convierte';
  if (p.video && p.video.apple === false) return 'el vídeo no es compatible con el iPhone: descárgala y se convierte';
  if (p.audio_apple === false) return 'el audio (AC-3/DTS) no suena en el iPhone: descárgala y se convierte';
  return '';
}
