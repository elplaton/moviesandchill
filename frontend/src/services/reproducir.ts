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
