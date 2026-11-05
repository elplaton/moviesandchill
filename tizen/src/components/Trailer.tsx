/*
 * El tráiler donde va la carátula de la ficha.
 *
 * Es el mismo archivo en `frontend/`, `mobile/` y `tizen/`.
 *
 * Se pidió así: al abrir un título se ve la carátula, y el tráiler aparece
 * **cuando ya está cargado**, encima, con un fundido. Por eso el componente
 * es invisible hasta que YouTube dice que está reproduciendo (no al crear el
 * reproductor: entre medias hay un negro, el logo y el título del vídeo), y
 * al acabar se desvanece y vuelve la carátula, que nunca se ha ido de debajo.
 *
 * Los tráileres son de YouTube (los da TMDB: `/api/media/{id}/trailer`, en
 * español y si no en el idioma original), así que se incrusta su reproductor
 * con la API oficial, desde youtube-nocookie.com, sin controles y sin que se
 * pueda tocar (`pointer-events: none`): es un fondo, no un reproductor. Se
 * agranda un poco más de lo que ocupa para recortar el título y el logo que
 * YouTube pinta en los bordes.
 *
 * El sonido lo decide quien lo pone (`sonido`). En la web y el móvil empieza
 * en silencio con un botón, porque un navegador no deja arrancar un vídeo
 * solo con sonido; en la tele suena siempre, y si el aparato no lo deja (el
 * WebView del Fire TV puede exigir un gesto), a los pocos segundos se arranca
 * en silencio: mejor eso que quedarse sin tráiler.
 */
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../services/api';

/** Lo que se agranda el vídeo sobre «cubrir»: recorta el título de arriba y
 *  el logo de abajo que YouTube pinta aunque no haya controles. */
const RECORTE = 1.18;
/** Si con sonido no ha arrancado en este tiempo, el aparato no lo deja. */
const ESPERA_CON_SONIDO_MS = 3500;
/** Un poco después de «reproduciendo»: los primeros fotogramas aún son negros. */
const RETRASO_FUNDIDO_MS = 500;
/** Si en este tiempo no se está viendo, se cuenta al servidor por qué. */
const VIGIA_MS = 15000;

/* eslint-disable @typescript-eslint/no-explicit-any */
type YT = any;

let api: Promise<YT> | null = null;
function cargarYouTube(): Promise<YT> {
  if (api) return api;
  api = new Promise<YT>((resolve, reject) => {
    const w = window as any;
    if (w.YT && w.YT.Player) { resolve(w.YT); return; }
    const anterior = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => { if (anterior) anterior(); resolve(w.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => { api = null; reject(new Error('YouTube no carga')); };
    document.head.appendChild(s);
  });
  return api;
}

// Lo que ya se sabe de cada título, para no volver a preguntar al reabrir la
// ficha (el servidor lo tiene cacheado, pero esto se ahorra hasta la vuelta).
const claves = new Map<string, string | null>();

async function claveDe(tmdbId: number, kind: string): Promise<string | null> {
  const id = `${kind}:${tmdbId}`;
  if (claves.has(id)) return claves.get(id) ?? null;
  try {
    const res = await apiFetch(`/media/${tmdbId}/trailer?media_type=${kind}`);
    if (!res.ok) return null;
    const d = await res.json();
    const clave = (d && d.key) || null;
    claves.set(id, clave);
    return clave;
  } catch {
    return null;
  }
}

// Lo ya contado, para no repetir la misma línea en el registro cada vez que
// se pasa por la misma tarjeta.
const contados = new Set<string>();

/**
 * Cuenta al servidor por qué no ha salido el tráiler (queda en Admin →
 * Registros, con el aparato). En un iPhone o una tele no hay consola que
 * mirar, y desde fuera solo se ve «no sale».
 */
function contarFallo(tmdbId: number | null | undefined, kind: string, motivo: string) {
  const id = `${kind}:${tmdbId}:${motivo}`;
  if (contados.has(id)) return;
  contados.add(id);
  const aparato = window.location.pathname.split('/')[1] || 'web';
  apiFetch('/media/trailer/fallo', {
    method: 'POST', body: JSON.stringify({ tmdb_id: tmdbId || null, kind, aparato, motivo }),
  }).catch(() => { /* sin servidor, sin registro */ });
}

export interface PropsTrailer {
  tmdbId?: number | null;
  /** 'movie' o 'series'. */
  kind: string;
  /** Si puede sonar. Se cambia en caliente (el botón de la web y el móvil). */
  sonido: boolean;
  /** Apagado mientras se ve otra cosa (el reproductor encima de la ficha):
   *  un tráiler sonando detrás de la película es lo último que se quiere. */
  activo: boolean;
  /** Avisa de cuándo se ve, para enseñar el botón de sonido solo entonces. */
  onVisible?: (visible: boolean) => void;
  className?: string;
}

export default function Trailer({ tmdbId, kind, sonido, activo, onVisible, className = '' }: PropsTrailer) {
  const caja = useRef<HTMLDivElement>(null);
  const hueco = useRef<HTMLDivElement>(null);
  const reproductor = useRef<YT>(null);
  const [clave, setClave] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const sonidoRef = useRef(sonido);
  sonidoRef.current = sonido;
  const avisar = useRef(onVisible);
  avisar.current = onVisible;

  useEffect(() => { if (avisar.current) avisar.current(visible); }, [visible]);

  useEffect(() => {
    setClave(null);
    if (!tmdbId) return;
    let vivo = true;
    claveDe(tmdbId, kind).then((c) => { if (vivo) setClave(c); });
    return () => { vivo = false; };
  }, [tmdbId, kind]);

  useEffect(() => {
    if (!activo || !clave || !hueco.current) return;
    let vivo = true;
    let fundido: ReturnType<typeof setTimeout> | null = null;
    let espera: ReturnType<typeof setTimeout> | null = null;
    // Por donde se ha llegado, para decir por qué no se ve si no se ve.
    let fase = 'cargando la API de YouTube';
    let visto = false;
    const vigia = setTimeout(() => {
      if (!vivo || visto) return;
      const p = reproductor.current;
      const estado = p && p.getPlayerState ? p.getPlayerState() : 'sin reproductor';
      contarFallo(tmdbId, kind, `${fase}; estado ${estado}`);
    }, VIGIA_MS);
    // YouTube sustituye el nodo por su iframe: se le da uno propio que React
    // no toca, o al desmontar React buscaria un hijo que ya no existe.
    const nodo = document.createElement('div');
    hueco.current.appendChild(nodo);

    const encajar = () => {
      const p = reproductor.current;
      const c = caja.current;
      if (!p || !c || !p.getIframe) return;
      const f: HTMLIFrameElement = p.getIframe();
      const w = c.clientWidth, h = c.clientHeight;
      if (!f || !w || !h) return;
      // «Cubrir» a mano: Chromium 53 (webOS 4) no tiene ResizeObserver ni
      // `object-fit` para un iframe.
      const ancho = w / h > 16 / 9 ? w : h * 16 / 9;
      const alto = ancho * 9 / 16;
      f.style.position = 'absolute';
      f.style.left = `${(w - ancho * RECORTE) / 2}px`;
      f.style.top = `${(h - alto * RECORTE) / 2}px`;
      f.style.width = `${ancho * RECORTE}px`;
      f.style.height = `${alto * RECORTE}px`;
      f.style.pointerEvents = 'none';
      f.setAttribute('tabindex', '-1');
    };

    cargarYouTube().then((Y) => {
      if (!vivo) return;
      fase = 'esperando a que el reproductor esté listo';
      reproductor.current = new Y.Player(nodo, {
        videoId: clave,
        host: 'https://www.youtube-nocookie.com',
        playerVars: {
          autoplay: 1, mute: sonidoRef.current ? 0 : 1, controls: 0, disablekb: 1, fs: 0,
          iv_load_policy: 3, modestbranding: 1, playsinline: 1, rel: 0, cc_load_policy: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: (e: YT) => {
            if (!vivo) return;
            fase = 'listo pero sin arrancar (el aparato no deja reproducir solo)';
            encajar();
            if (sonidoRef.current) { e.target.unMute(); e.target.setVolume(100); } else e.target.mute();
            e.target.playVideo();
            // Con sonido puede que el aparato no lo deje arrancar solo: si no
            // ha empezado en un rato, en silencio.
            espera = setTimeout(() => {
              const p = reproductor.current;
              if (vivo && p && p.getPlayerState && p.getPlayerState() !== Y.PlayerState.PLAYING) {
                p.mute();
                p.playVideo();
              }
            }, ESPERA_CON_SONIDO_MS);
          },
          onStateChange: (e: YT) => {
            if (!vivo) return;
            if (e.data === Y.PlayerState.PLAYING) {
              visto = true;
              if (fundido) clearTimeout(fundido);
              fundido = setTimeout(() => { if (vivo) setVisible(true); }, RETRASO_FUNDIDO_MS);
            } else if (e.data === Y.PlayerState.ENDED) {
              setVisible(false);
            }
          },
          // Video retirado, o que no deja incrustarse: se queda la caratula.
          onError: (e: YT) => {
            if (!vivo) return;
            setVisible(false);
            // 2 id no válido, 5 el reproductor HTML5 no puede, 100 retirado,
            // 101/150 no deja incrustarse, 153 falta la cabecera Referer.
            visto = true;
            contarFallo(tmdbId, kind, `error de YouTube ${e && e.data}`);
          },
        },
      });
    }).catch(() => {
      // Sin YouTube, la caratula.
      visto = true;
      if (vivo) contarFallo(tmdbId, kind, 'no carga la API de YouTube');
    });

    window.addEventListener('resize', encajar);
    return () => {
      vivo = false;
      clearTimeout(vigia);
      if (fundido) clearTimeout(fundido);
      if (espera) clearTimeout(espera);
      window.removeEventListener('resize', encajar);
      setVisible(false);
      try { if (reproductor.current) reproductor.current.destroy(); } catch { /* ya no estaba */ }
      reproductor.current = null;
      if (nodo.parentNode) nodo.parentNode.removeChild(nodo);
    };
    // tmdbId y kind van con `clave`: si cambian, cambia la clave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo, clave]);

  // El boton de la web y el movil cambia el sonido sin rehacer el reproductor.
  useEffect(() => {
    const p = reproductor.current;
    if (!p || !p.mute) return;
    if (sonido) { p.unMute(); p.setVolume(100); } else p.mute();
  }, [sonido]);

  return (
    <div ref={caja} aria-hidden="true"
      className={`absolute inset-0 overflow-hidden pointer-events-none transition-opacity duration-700 ${visible ? 'opacity-100' : 'opacity-0'} ${className}`}>
      <div ref={hueco} />
    </div>
  );
}
