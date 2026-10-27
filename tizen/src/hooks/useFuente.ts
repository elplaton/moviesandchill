import { useEffect, useState, type RefObject } from 'react';
import type Hls from 'hls.js';
import { getApiBase } from '../services/api';
import { comoAbrirHls, modoDeReproduccion, type Modo } from '../services/reproducir';

export interface Fuente {
  /** El `src` del <video>, o nada si la engancha hls.js (pone el suyo, un
   *  `blob:`) o si aun no se sabe por donde ir. */
  src: string | undefined;
  /** Por donde va: el reproductor lo necesita para saber si puede cambiar de
   *  idioma con `audioTracks` (solo con el archivo tal cual) o si tiene que
   *  pedir la version adaptada con otra pista. `null` mientras se decide. */
  modo: Modo | null;
}

/**
 * De donde saca el `<video>` la imagen.
 *
 * Hasta saber la entrada de reproduccion y el modo no hay `src`: el <video>
 * empezaria por el archivo tal cual, que es justo lo que puede no oirse.
 * El mismo hook vive en `frontend/` y `mobile/`; aqui las URL llevan delante
 * el servidor, porque la copia instalada en la tele no comparte origen con
 * la API.
 *
 * `audio` es la pista elegida a mano en el panel de idioma (su `order`, que
 * es la posicion 0:a:N que entiende el servidor). Con ella se va **siempre**
 * por la version adaptada con `&audio=N`, tambien con lo descargado: en el
 * Fire TV `audioTracks` no existe y en Samsung/LG depende del modelo, asi que
 * la unica forma segura de que suene otra pista es que el servidor mande solo
 * esa. Si el aparato no sabe HLS se queda en el archivo tal cual (con la
 * primera pista, como antes): el reproductor lo comprueba antes de pedirlo.
 */
export function useFuente(ref: RefObject<HTMLVideoElement>, path: string, ticket: string | null,
                          audio: number | null = null): Fuente {
  const [modo, setModo] = useState<{ path: string; modo: Modo } | null>(null);
  useEffect(() => {
    let vivo = true;
    modoDeReproduccion(path).then(m => { if (vivo) setModo({ path, modo: m }); });
    return () => { vivo = false; };
  }, [path]);

  // Como abre este aparato la version adaptada. Solo se pregunta si hace
  // falta: importar hls.js para nada le cuesta memoria a un Fire TV Stick.
  const forzar = audio !== null;
  const [hlsAparato, setHlsAparato] = useState<Modo | null>(null);
  useEffect(() => {
    if (!forzar || hlsAparato !== null) return;
    let vivo = true;
    comoAbrirHls().then(m => { if (vivo) setHlsAparato(m); });
    return () => { vivo = false; };
  }, [forzar, hlsAparato]);

  // El modo de otro episodio no vale: se espera al de este.
  const m = forzar ? hlsAparato : modo?.path === path ? modo.modo : null;
  // La pista solo viaja si se va por HLS: al archivo tal cual no le dice nada.
  const pista = forzar && m !== 'directo' ? `&audio=${audio}` : '';
  const consulta = ticket === null ? ''
    : `path=${encodeURIComponent(path)}&token=${encodeURIComponent(ticket)}${pista}`;
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
    // Cambiar de pista cambia `consulta`: se suelta el hls.js de la anterior
    // y se engancha uno nuevo, que vuelve a dar `loadedmetadata`.
    return () => { vivo = false; hls?.destroy(); };
  }, [listo, m, consulta, base, ref]);

  if (!listo) return { src: undefined, modo: null };
  if (m === 'directo') return { src: `${base}/stream?${consulta}`, modo: m };
  if (m === 'hls') return { src: `${base}/hls/index.m3u8?${consulta}`, modo: m };
  return { src: undefined, modo: m };
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
