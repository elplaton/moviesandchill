import { useEffect, useState, type RefObject } from 'react';
import type Hls from 'hls.js';
import { comoAbrirHls, modoDeReproduccion, type Modo } from '../services/reproducir';

export interface Fuente {
  /** El `src` del `<video>`, o nada si lo pone hls.js (un `blob:`). */
  src: string | undefined;
  /** Como se esta abriendo ahora: `directo`, `hls` o `hlsjs` (null mientras
   *  no se sabe). Con `directo` el cambio de idioma de Safari funciona. */
  modo: Modo | null;
  /** Si este navegador sabe abrir la version adaptada de alguna forma: es lo
   *  que deja cambiar de idioma donde no hay `audioTracks`. */
  hlsPosible: boolean;
  /** La version con la pista pedida no ha cargado (el servidor no sabe
   *  adaptar este archivo): hay que volver a la de antes. */
  fallo: boolean;
}

/**
 * De donde saca el `<video>` la imagen: el `src` que hay que ponerle, o nada
 * si la fuente la engancha hls.js (que pone el suyo, un `blob:`).
 *
 * Hasta saber la entrada de reproduccion y el modo no hay `src`: el <video>
 * empezaria por el archivo tal cual, que es justo lo que no se oye.
 *
 * Aqui es donde mas trabaja hls.js: ni Chrome ni Firefox traen HLS propio,
 * y sin el un MKV con audio AC-3/DTS se veia mudo en Windows y en el Mac. El
 * mismo hook vive en el movil (`mobile/`).
 *
 * `audio` es la pista elegida en el menu (su `order`, 0:a:N). Sin ella, todo
 * como siempre. Con ella se pide la version adaptada con esa pista aunque el
 * archivo se abriera tal cual: Chrome no implementa `audioTracks` y siempre
 * suena la primera, asi que la unica forma de cambiar es que el servidor mande
 * otra. Si el navegador no sabe HLS de ninguna forma, se queda en directo.
 */
export function useFuente(ref: RefObject<HTMLVideoElement>, path: string, ticket: string | null,
                          audio?: number | null): Fuente {
  const [modo, setModo] = useState<{ path: string; modo: Modo } | null>(null);
  useEffect(() => {
    let vivo = true;
    modoDeReproduccion(path).then(m => { if (vivo) setModo({ path, modo: m }); });
    return () => { vivo = false; };
  }, [path]);

  // Que HLS sabe este navegador. Va aparte del modo del archivo para que, al
  // elegir idioma, la fuente nueva se sepa en el mismo render: sin esperar a
  // una promesa no hay un instante sin `src` entre una y otra.
  const [nav, setNav] = useState<Modo | null>(null);
  useEffect(() => {
    let vivo = true;
    comoAbrirHls().then(m => { if (vivo) setNav(m); });
    return () => { vivo = false; };
  }, []);
  const hlsPosible = nav !== null && nav !== 'directo';
  const conAudio = audio != null && hlsPosible;

  // El modo de otro episodio no vale: se espera al de este.
  const base = modo?.path === path ? modo.modo : null;
  const m = conAudio ? nav : base;
  const consulta = ticket === null ? '' : `path=${encodeURIComponent(path)}&token=${encodeURIComponent(ticket)}`
    + (conAudio ? `&audio=${audio}` : '');
  const listo = ticket !== null && m !== null;

  // El fallo es de una consulta concreta: con otra (otra pista, otro archivo)
  // ya no vale.
  const [fallida, setFallida] = useState<string | null>(null);
  const fallo = conAudio && fallida === consulta;

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
        // La lista con otra pista no ha llegado: el servidor no sabe adaptar
        // este archivo (un MP4 fragmentado, un AVI sin indice). Reintentar no
        // lo arregla; se avisa para volver a lo que se estaba viendo.
        if (conAudio && (d.details === H.ErrorDetails.MANIFEST_LOAD_ERROR
                         || d.details === H.ErrorDetails.MANIFEST_PARSING_ERROR)) {
          setFallida(consulta);
          return;
        }
        // Lo de red se reintenta (un trozo que tardo demasiado: el servidor
        // lo estaba fabricando); lo del decodificador se recupera una vez.
        if (d.type === H.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (d.type === H.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
      });
      hls.loadSource(`/api/hls/index.m3u8?${consulta}`);
      hls.attachMedia(v);
    });
    return () => { vivo = false; hls?.destroy(); };
  }, [listo, m, consulta, conAudio, ref]);

  // Lo mismo con el HLS de Safari: ahi el fallo llega como `error` del
  // `<video>`. Solo cuenta si trae `v.error` y es de esta URL: un `<video>` sin
  // fuente tambien dispara `error` y no significa nada.
  useEffect(() => {
    const v = ref.current;
    if (!listo || m !== 'hls' || !conAudio || !v) return;
    const onError = () => {
      if (v.error && v.currentSrc.includes(`audio=${audio}`)) setFallida(consulta);
    };
    v.addEventListener('error', onError);
    return () => v.removeEventListener('error', onError);
  }, [listo, m, conAudio, audio, consulta, ref]);

  const src = !listo ? undefined
    : m === 'directo' ? `/api/stream?${consulta}`
    : m === 'hls' ? `/api/hls/index.m3u8?${consulta}`
    : undefined;
  return { src, modo: listo ? m : null, hlsPosible, fallo };
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
