import { apiFetch } from './api';

/**
 * Ver sin descargar: el servidor lee el archivo de Telegram mientras se ve
 * (como Telegram Desktop). Antes de abrir el reproductor se le pregunta si se
 * puede: lo comprimido de verdad hay que descargarlo. La respuesta trae una
 * `path` (`tg:<canal>:<mensaje>`) que el reproductor abre como cualquier otra.
 *
 * Es el gemelo de `frontend/` y `mobile/`, con una diferencia: una tele si
 * puede traer decodificador de AC-3 (Samsung y LG lo suelen tener), asi que
 * aqui se le pregunta antes de mandar a adaptar lo que quiza no hace falta.
 */
export interface Reproduccion {
  modo: 'ver' | 'descargar';
  motivo: string;
  path: string | null;
  pistas?: Pistas | null;
}

export interface Pistas {
  container?: string;
  video?: { codec?: string; bits?: number | null; height?: number } | null;
  audio?: { codec?: string }[];
  /** El servidor puede adaptarlo al vuelo (HLS): audio a AAC y la imagen
   *  copiada o, si no es H.264/HEVC (un AVI con XviD), recodificada. */
  hls?: boolean;
  default_audio?: number | null;
}

/**
 * Como se reproduce una ruta `tg:` en este aparato: tal cual (`directo`) o
 * adaptada al vuelo por el servidor (services/hls.py), con hls.js (`hlsjs`) o
 * con el HLS propio del navegador si lo trae y hls.js no puede (`hls`).
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
 * Como abre este aparato la versión adaptada: hls.js antes que el HLS propio,
 * porque en las teles el propio, si lo hay, es el de un reproductor de hace
 * años, y con fMP4 no es de fiar. `directo` quiere decir que no puede.
 *
 * Es del aparato y no del archivo, así que se pregunta una vez: lo usan
 * también el reproductor (antes de cambiar de idioma por HLS, para saber si
 * puede) y `useFuente`, y los dos tienen que llegar a la misma respuesta.
 */
let abrirHls: Promise<Modo> | null = null;
export function comoAbrirHls(): Promise<Modo> {
  if (!abrirHls) {
    abrirHls = (async (): Promise<Modo> => {
      try {
        const { default: Hls } = await import('hls.js');
        if (Hls.isSupported()) return 'hlsjs';
      } catch { /* sin hls.js se intenta lo siguiente */ }
      return sabe('application/vnd.apple.mpegurl') ? 'hls' : 'directo';
    })();
  }
  return abrirHls;
}

function sabe(tipo: string): boolean {
  try {
    return !!document.createElement('video').canPlayType(tipo);
  } catch {
    return false;
  }
}

/** Audio que un navegador no decodifica. DTS y TrueHD, ninguno. */
const SIN_SONIDO = /^(ac3|eac3|dts|truehd)$/i;
/** Lo que la tele dice saber decodificar. Se le pregunta a ella: depende del
 *  modelo, no de la marca. */
const TIPO_AUDIO: Record<string, string> = {
  ac3: 'audio/mp4; codecs="ac-3"',
  eac3: 'audio/mp4; codecs="ec-3"',
};
/** Contenedores e imagen que abre un navegador. Un AVI no lo abre ninguno, y
 *  XviD/DivX (`mpeg4`), que es lo que llevan casi todos, tampoco. */
const CONTENEDOR_WEB = /matroska|webm|mp4|mov/i;
const VIDEO_WEB = /^(h264|hevc|vp8|vp9|av1)$/i;

function suena(codec: string | undefined): boolean {
  const c = (codec || '').toLowerCase();
  if (!SIN_SONIDO.test(c)) return true;
  return !!TIPO_AUDIO[c] && sabe(TIPO_AUDIO[c]);
}

/** Si la tele abre el archivo sin adaptarlo: MKV/MP4/WebM con imagen que
 *  entienda y con la pista que va a sonar decodificable. Cuenta la que va a
 *  sonar (la primera o la de por defecto), no que haya alguna buena. */
function abreTalCual(p: Pistas): boolean {
  if (!CONTENEDOR_WEB.test(p.container || '')) return false;
  if (p.video?.codec && !VIDEO_WEB.test(p.video.codec)) return false;
  const audio = p.audio || [];
  const suenan = [audio[0], audio[p.default_audio ?? 0]].filter(Boolean);
  return suenan.every(a => suena(a.codec));
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
 * Por que este aparato no puede ver el archivo sin descargarlo, o '' si
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

/** Audio que la tele no decodifica y que el servidor no puede adaptar al
 *  vuelo: el video se veria sin sonido. */
export function audioQueNoSuena(r: Reproduccion): boolean {
  if (r.pistas?.hls) return false;
  const audio = r.pistas?.audio || [];
  return audio.length > 0 && audio.every(a => !suena(a.codec));
}
