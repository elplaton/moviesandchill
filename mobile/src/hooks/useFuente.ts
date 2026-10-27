import { useEffect, useState, type RefObject } from 'react';
import type Hls from 'hls.js';
import { comoAbrirHls, modoDeReproduccion, type Modo } from '../services/reproducir';

/**
 * De donde saca el `<video>` la imagen: el `src` que hay que ponerle, o nada
 * si la fuente la engancha hls.js (que pone el suyo, un `blob:`).
 *
 * Hasta saber la entrada de reproduccion y el modo no hay `src`: el <video>
 * empezaria por el archivo tal cual, que es justo lo que no se oye.
 *
 * El mismo hook vive en la web (`frontend/`): alli es donde mas se usa
 * hls.js, porque ni Chrome ni Firefox traen HLS propio.
 *
 * `audio` es la pista de audio elegida (0:a:N, el `order` de `/media/tracks`).
 * Sin ella, como siempre: tal cual si el aparato lo abre, adaptada si no. Con
 * ella se pide **siempre la version adaptada** con `&audio=N`, aunque el
 * archivo se abriera tal cual: es la unica forma de cambiar de idioma donde el
 * navegador no lo deja (Chrome no implementa `audioTracks`) o donde la version
 * adaptada solo trae una pista (el iPhone viendo sin descargar). Vale tambien
 * para lo descargado. Si este aparato no sabe abrir HLS se queda en directo.
 */
export function useFuente(ref: RefObject<HTMLVideoElement>, path: string, ticket: string | null,
                          audio: number | null = null): string | undefined {
  // El modo va atado a la ruta **y** a la pista: el de otro episodio, o el de
  // antes de cambiar de idioma, no vale.
  const clave = `${audio ?? ''}|${path}`;
  const [modo, setModo] = useState<{ clave: string; modo: Modo } | null>(null);
  useEffect(() => {
    let vivo = true;
    const pedir = audio === null ? modoDeReproduccion(path) : comoAbrirHls();
    pedir.then(m => { if (vivo) setModo({ clave: `${audio ?? ''}|${path}`, modo: m }); });
    return () => { vivo = false; };
  }, [path, audio]);

  const m = modo?.clave === clave ? modo.modo : null;
  const base = ticket === null ? '' : `path=${encodeURIComponent(path)}&token=${encodeURIComponent(ticket)}`;
  // La pista solo la entiende la version adaptada; el archivo tal cual es uno.
  const consulta = audio !== null && m !== 'directo' ? `${base}&audio=${audio}` : base;
  const listo = ticket !== null && m !== null;

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
      hls.loadSource(`/api/hls/index.m3u8?${consulta}`);
      hls.attachMedia(v);
    });
    return () => { vivo = false; hls?.destroy(); };
  }, [listo, m, consulta, ref]);

  if (!listo) return undefined;
  if (m === 'directo') return `/api/stream?${consulta}`;
  if (m === 'hls') return `/api/hls/index.m3u8?${consulta}`;
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
  // Un minuto por delante: el servidor pausa ffmpeg si se adelanta mucho a lo
  // que se pide, asi que pedir mas solo serviria para hacerle esperar.
  maxBufferLength: 60,
};
