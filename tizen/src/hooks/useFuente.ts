import { useEffect, useState, type RefObject } from 'react';
import type Hls from 'hls.js';
import { getApiBase } from '../services/api';
import { modoDeReproduccion, type Modo } from '../services/reproducir';

/**
 * De donde saca el `<video>` la imagen: el `src` que hay que ponerle, o nada
 * si la fuente la engancha hls.js (que pone el suyo, un `blob:`).
 *
 * Hasta saber la entrada de reproduccion y el modo no hay `src`: el <video>
 * empezaria por el archivo tal cual, que es justo lo que puede no oirse.
 * El mismo hook vive en `frontend/` y `mobile/`; aqui las URL llevan delante
 * el servidor, porque la copia instalada en la tele no comparte origen con
 * la API.
 */
export function useFuente(ref: RefObject<HTMLVideoElement>, path: string, ticket: string | null): string | undefined {
  const [modo, setModo] = useState<{ path: string; modo: Modo } | null>(null);
  useEffect(() => {
    let vivo = true;
    modoDeReproduccion(path).then(m => { if (vivo) setModo({ path, modo: m }); });
    return () => { vivo = false; };
  }, [path]);

  // El modo de otro episodio no vale: se espera al de este.
  const m = modo?.path === path ? modo.modo : null;
  const consulta = ticket === null ? '' : `path=${encodeURIComponent(path)}&token=${encodeURIComponent(ticket)}`;
  const listo = ticket !== null && m !== null;
  const base = getApiBase();

  useEffect(() => {
    const v = ref.current;
    if (!listo || m !== 'hlsjs' || !v) return;
    let vivo = true;
    let hls: Hls | null = null;
    import('hls.js').then(({ default: H }) => {
      if (!vivo) return;
      hls = new H(CONFIG);
      hls.on(H.Events.ERROR, (_e, d) => {
        if (!d.fatal || !hls) return;
        // Lo de red se reintenta (un trozo que tardo demasiado: el servidor
        // lo estaba fabricando); lo del decodificador se recupera una vez.
        if (d.type === H.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (d.type === H.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
      });
      hls.loadSource(`${base}/hls/index.m3u8?${consulta}`);
      hls.attachMedia(v);
    });
    return () => { vivo = false; hls?.destroy(); };
  }, [listo, m, consulta, base, ref]);

  if (!listo) return undefined;
  if (m === 'directo') return `${base}/stream?${consulta}`;
  if (m === 'hls') return `${base}/hls/index.m3u8?${consulta}`;
  return undefined;
}

/**
 * El servidor fabrica cada trozo cuando se pide, y tras un salto arranca
 * ffmpeg de nuevo leyendo de Telegram: el primer byte de un trozo puede tardar
 * bastantes segundos (el servidor espera hasta 45). Con los 10 s que da hls.js
 * por defecto se cortaba y volvia a pedir lo mismo.
 */
const ESPERA = {
  maxTimeToFirstByteMs: 50_000,
  maxLoadTimeMs: 120_000,
  timeoutRetry: { maxNumRetry: 2, retryDelayMs: 0, maxRetryDelayMs: 0 },
  errorRetry: { maxNumRetry: 3, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
};
const CONFIG = {
  manifestLoadPolicy: { default: ESPERA },
  playlistLoadPolicy: { default: ESPERA },
  fragLoadPolicy: { default: ESPERA },
  // Menos por delante que en el ordenador: un Fire TV Stick tiene 1 GB de
  // memoria, y el servidor pausa ffmpeg si se adelanta mucho de todas formas.
  maxBufferLength: 30,
  maxBufferSize: 60 * 1000 * 1000,
};
