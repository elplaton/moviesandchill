import { useEffect, useRef, useState } from 'react';
import { fetchSubtitles, streamTicket, subtitleUrl, type ExternalSubtitle } from '../services/tracks';
import { useAirplay } from '../hooks/useAirplay';
import { IAirplay, IClose } from './Icons';
import { markWatched, resumePoint, setWatched } from '../utils/progress';
import { useSiguiente } from '../hooks/useSiguiente';
import SiguienteEp from './SiguienteEp';

interface Props {
  path: string; title: string; subtitle?: string; poster?: string; backdrop?: string;
  /** De que titulo es el video. Va al guardar la posicion, y es lo que permite
   *  que ver un episodio empiece a seguir la serie (avisos de episodio nuevo);
   *  sin esto el servidor guarda la posicion pero no sabe de que serie es. */
  tmdbId?: number;
  mediaType?: 'movie' | 'series';
  onClose: () => void;
}

/**
 * Reproductor del telefono: el `<video>` del sistema con sus propios
 * controles, **en la pagina** y a pantalla llena, no en la pantalla completa
 * nativa.
 *
 * Esa es la decision que manda aqui y costo cambiarla. Antes, en cuanto
 * arrancaba, se llamaba a `webkitEnterFullscreen()` y se le pasaba el video al
 * reproductor del sistema, que trae mas cosas hechas (girar a apaisado solo,
 * su propio boton de salir). El problema es que ese reproductor **se pinta
 * fuera de la pagina**: encima de el no se puede dibujar absolutamente nada,
 * asi que la tarjeta del siguiente episodio obligaba a salirse de la pantalla
 * completa para poder verse. Se pidio que apareciera dentro del reproductor,
 * sin tener que salir, igual que en la web y en la tele, y la unica forma es
 * no entrar en esa pantalla completa.
 *
 * Lo que se gana: la tarjeta del siguiente episodio, el boton de cerrar y
 * cualquier cosa que haga falta pintar encima del video funcionan igual que en
 * los otros clientes. Lo que se pierde: el giro automatico a apaisado, que es
 * cosa del reproductor del sistema. Si alguien lo quiere, el boton de pantalla
 * completa sigue estando en la barra de controles nativa; ahi la tarjeta
 * vuelve a no poder dibujarse, y por eso al aparecer se sale (`porLaTarjeta`).
 *
 * Se cierra con el boton de arriba a la izquierda, al terminar el video o con
 * el gesto de atras del telefono: al abrirse se apila una entrada en el
 * historial para que "atras" signifique "cerrar el video" y no "volver a la
 * pantalla anterior".
 *
 * Mientras carga se tapa con una pantalla de espera: sin ella se ve un
 * instante el poster con los controles encima antes de que arranque la imagen.
 */
export default function Player(props: Props) {
  const { onClose } = props;
  // Que se esta reproduciendo ahora, que no siempre es lo que dijo el padre:
  // al acabar un capitulo el reproductor pasa al siguiente por su cuenta. Los
  // nombres de dentro son los de siempre, asi que el resto no se entera.
  const [actual, setActual] = useState(() => ({
    path: props.path, title: props.title, subtitle: props.subtitle,
    poster: props.poster, backdrop: props.backdrop,
    tmdbId: props.tmdbId, mediaType: props.mediaType,
  }));
  useEffect(() => {
    setActual({ path: props.path, title: props.title, subtitle: props.subtitle,
                poster: props.poster, backdrop: props.backdrop,
                tmdbId: props.tmdbId, mediaType: props.mediaType });
  }, [props.path, props.title, props.subtitle, props.poster, props.backdrop,
      props.tmdbId, props.mediaType]);
  const { path, title, subtitle, poster, backdrop, tmdbId, mediaType } = actual;

  const ref = useRef<HTMLVideoElement>(null);
  const [subs, setSubs] = useState<ExternalSubtitle[]>([]);
  const [preparando, setPreparando] = useState(true);
  const [fallo, setFallo] = useState('');
  const airplay = useAirplay(ref);

  /**
   * Hemos salido de la pantalla completa nosotros, para enseñar la tarjeta.
   *
   * Solo pasa si alguien ha entrado a mano en la pantalla completa del sistema
   * con el boton de la barra de controles: ahi no se puede dibujar encima, asi
   * que al aparecer la tarjeta se sale. La marca existe porque salir de la
   * pantalla completa tambien es la señal del boton "Hecho", y sin ella
   * enseñar la tarjeta parecería que alguien ha pulsado "Hecho".
   */
  const porLaTarjeta = useRef(false);
  const salirDePantallaCompleta = () => {
    const v = ref.current as unknown as { webkitExitFullscreen?: () => void } | null;
    const enNativa = (ref.current as unknown as { webkitDisplayingFullscreen?: boolean })
      ?.webkitDisplayingFullscreen;
    if (!enNativa && !document.fullscreenElement) return;   // ya estamos en la pagina
    porLaTarjeta.current = true;
    try {
      if (typeof v?.webkitExitFullscreen === 'function') v.webkitExitFullscreen();
      else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    } catch { /* ya estaba fuera */ }
  };

  const sig = useSiguiente({
    path, tmdbId,
    onVer: (siguiente) => {
      const v = ref.current;
      // El que se deja se marca visto antes de cambiar: si no, se quedaria a
      // medias en "Continuar viendo".
      if (v?.duration) {
        markWatched({ path, title, subtitle, poster, backdrop,
                      tmdb_id: tmdbId ?? null, media_type: mediaType,
                      position: v.duration, duration: v.duration });
      }
      setPreparando(true);
      setActual((a) => ({ ...a, path: siguiente.path, subtitle: siguiente.label }));
    },
    onCerrar: onClose,
    pausar: () => ref.current?.pause(),
  });

  // Si la tarjeta aparece con alguien dentro de la pantalla completa nativa,
  // hay que salir: es el unico sitio donde no se puede dibujar encima.
  const hayTarjeta = sig.decision.tipo !== 'nada';
  useEffect(() => {
    if (hayTarjeta) salirDePantallaCompleta();
  }, [hayTarjeta]); // eslint-disable-line react-hooks/exhaustive-deps

  // El `src` espera a la entrada de reproducción: el token de acceso caduca a
  // la hora y cortaba las películas largas por la mitad. Con AirPlay es
  // imprescindible, porque quien pide los trozos es el Apple TV.
  const [ticket, setTicket] = useState<string | null>(null);
  const src = ticket === null
    ? undefined
    : `/api/stream?path=${encodeURIComponent(path)}&token=${encodeURIComponent(ticket)}`;

  // El selector de subtítulos lo pone el reproductor del sistema; aquí solo
  // hay que colgarle las pistas que haya.
  useEffect(() => {
    let vivo = true;
    streamTicket(path).then(t => { if (vivo) setTicket(t); });
    fetchSubtitles(path).then(s => { if (vivo) setSubs(s); });
    return () => { vivo = false; };
  }, [path]);

  useEffect(() => {
    const v = ref.current; if (!v) return;
    // El punto de reanudacion lo da el servidor, asi que llega tarde: puede
    // resolverse antes o despues de que el video tenga metadatos. Lo aplica el
    // que llegue el ultimo de los dos, y una sola vez.
    let inicio = -1;
    const aplicarInicio = () => {
      if (inicio <= 0 || !v.duration) return;
      v.currentTime = inicio;
      inicio = -1;
    };
    resumePoint(path).then((s) => { inicio = s; if (v.readyState >= 1) aplicarInicio(); });
    let last = 0;
    let closed = false;
    const close = () => { if (closed) return; closed = true; onClose(); };

    const entrada = () => ({ path, title, subtitle, poster, backdrop,
                             tmdb_id: tmdbId ?? null, media_type: mediaType,
                             position: v.currentTime, duration: v.duration });
    const onMeta = () => aplicarInicio();
    const onTime = () => {
      // Se pregunta que viene despues con tres minutos de margen, para que la
      // tarjeta aparezca sin un hueco esperando a la red.
      sig.mirar(v.currentTime, v.duration);
      const now = Date.now(); if (now - last < 5000 || !v.duration) return; last = now;
      // Lo terminado se marca, no se borra: es lo que deja al servidor ofrecer
      // el episodio siguiente.
      if (v.currentTime / v.duration >= 0.97) markWatched(entrada());
      else setWatched(entrada());
    };
    const onEnded = () => {
      markWatched({ ...entrada(), position: v.duration || 0, duration: v.duration || 0 });
      // Si hay algo que preguntar, el reproductor se queda abierto con la
      // tarjeta encima del ultimo fotograma.
      if (sig.alTerminar()) return;
      history.state?.player ? history.back() : close();
    };
    // El telefono no desmonta nada al bloquear la pantalla o cambiar de app:
    // sin esto se perdia justo el minuto por el que se dejo la pelicula.
    const onSalir = () => { if (v.duration && v.currentTime > 0) setWatched(entrada(), true); };
    const onOculta = () => { if (document.hidden) onSalir(); };

    // La espera se retira en cuanto hay imagen. Ya no hay que esperar a que se
    // abra el reproductor del sistema: el video se ve aqui mismo.
    const onPlaying = () => setPreparando(false);

    const onError = () => {
      setPreparando(false);
      setFallo('No se ha podido abrir el vídeo. Puede que el archivo no esté listo todavía.');
    };
    // Red de seguridad: si el vídeo no arranca (archivo a medio convertir, un
    // codec que el telefono no abre) mas vale ver el reproductor y sus
    // controles que quedarse en una espera eterna.
    const rendicion = setTimeout(() => setPreparando(false), 20000);

    // Salir de la pantalla completa nativa NO cierra el reproductor: se vuelve
    // a la pagina, que es donde vive. Solo hace falta consumir la marca si
    // hemos salido nosotros para enseñar la tarjeta.
    const onExitIos = () => { porLaTarjeta.current = false; };
    const onPop = () => close();

    history.pushState({ player: true }, '');
    window.addEventListener('popstate', onPop);
    window.addEventListener('pagehide', onSalir);
    document.addEventListener('visibilitychange', onOculta);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('ended', onEnded);
    v.addEventListener('playing', onPlaying);
    v.addEventListener('error', onError);
    v.addEventListener('webkitendfullscreen', onExitIos);

    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('pagehide', onSalir);
      document.removeEventListener('visibilitychange', onOculta);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('playing', onPlaying);
      v.removeEventListener('error', onError);
      clearTimeout(rendicion);
      v.removeEventListener('webkitendfullscreen', onExitIos);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      // Si se cerro sin pasar por el historial (fin del video), se retira la entrada.
      if (history.state?.player) history.back();
      if (v.duration && v.currentTime > 0) setWatched(entrada(), true);
    };
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  const cerrar = () => { history.state?.player ? history.back() : onClose(); };

  return (
    <div className="fixed inset-0 z-[70] bg-black">
      {/* preload="auto" es lo unico que se le puede pedir a iOS sobre cuanto
          adelanta: cuanto buffer guarda lo decide el reproductor del sistema
          segun la velocidad que mida, y no hay forma de exigirle "carga dos
          minutos antes de empezar". Si el archivo pide mas Mbps de los que da
          la red, va a tirones y eso no se arregla aqui. */}
      <video ref={ref} src={src} controls autoPlay playsInline preload="auto" poster={backdrop}
        crossOrigin="use-credentials" x-webkit-airplay="allow"
        className="w-full h-full bg-black object-contain">
        {subs.map(sub => (
          <track key={sub.path} kind="subtitles" src={subtitleUrl(sub.path, ticket || undefined)}
            srcLang={sub.language} label={sub.label} />
        ))}
      </video>

      {/* El boton de cerrar lo ponemos nosotros: el "Hecho" que habia antes era
          del reproductor del sistema, y ya no se entra en el. */}
      {!preparando && !fallo && (
        <div className="absolute top-0 inset-x-0 flex items-start gap-3 p-4 pt-[max(1rem,env(safe-area-inset-top))]
                        pointer-events-none bg-gradient-to-b from-black/70 to-transparent">
          <button onClick={cerrar} aria-label="Cerrar"
            className="pointer-events-auto grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black/50 active:bg-white/20">
            <span className="w-5 h-5"><IClose /></span>
          </button>
          <div className="min-w-0 pt-1">
            <p className="truncate text-[15px] font-semibold leading-tight">{title}</p>
            {subtitle && <p className="truncate text-[13px] text-nf-text2">{subtitle}</p>}
          </div>
        </div>
      )}

      {!preparando && <SiguienteEp sig={sig} />}

      {airplay.activo && !preparando && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
          <span className="w-14 h-14 text-nf-red"><IAirplay /></span>
          <p className="mt-4 text-[17px] font-semibold leading-tight">{title}</p>
          <p className="mt-2 text-[14px] text-nf-text2">Reproduciendo en otra pantalla</p>
          <button onClick={airplay.elegir}
            className="mt-6 h-11 px-5 rounded-xl bg-white/15 text-[15px] font-semibold active:bg-white/25">
            Cambiar de dispositivo
          </button>
        </div>
      )}

      {(preparando || fallo) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
          {backdrop && (
            <img src={backdrop} alt="" className="absolute inset-0 w-full h-full object-cover opacity-25" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/80 to-black/60" />
          <div className="relative">
            {fallo ? (
              <>
                <p className="text-[16px] font-semibold">{fallo}</p>
                <button onClick={onClose} className="mt-5 h-11 px-6 rounded-xl bg-white/15 text-[15px] font-semibold">
                  Cerrar
                </button>
              </>
            ) : (
              <>
                <span className="block w-10 h-10 mx-auto rounded-full border-[3px] border-white/20 border-t-white animate-spin" />
                <p className="mt-5 text-[17px] font-semibold leading-tight">{title}</p>
                {subtitle && <p className="mt-1 text-[14px] text-nf-text2">{subtitle}</p>}
                <p className="mt-3 text-[13px] text-nf-text3">Preparando el vídeo…</p>
                {airplay.disponible && (
                  <button onClick={airplay.elegir}
                    className="mt-6 inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-white/15 text-[15px] font-semibold active:bg-white/25">
                    <span className="w-5 h-5"><IAirplay /></span>
                    Ver en otra pantalla
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
