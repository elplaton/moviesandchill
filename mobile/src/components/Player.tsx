import { useEffect, useRef, useState } from 'react';
import { fetchSubtitles, streamTicket, subtitleUrl, type ExternalSubtitle } from '../services/tracks';
import { useAirplay } from '../hooks/useAirplay';
import { IAirplay } from './Icons';
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
 * Reproductor: solo el <video> del sistema, sin barra ni botones propios.
 *
 * En cuanto arranca entra en pantalla completa nativa, que en el telefono ya
 * trae todo (girar, barra de tiempo, volumen, AirPlay, subtitulos, PiP y el
 * boton de salir). Se cierra al salir de esa pantalla completa, al terminar
 * el video o con el gesto de atras del telefono: al abrirse se apila una
 * entrada en el historial para que "atras" signifique "cerrar el video" y no
 * "volver a la pantalla anterior".
 *
 * Mientras carga se tapa con una pantalla de espera. Si no, se veia el
 * reproductor en linea con sus propios controles durante un segundo y luego
 * saltaba encima el del sistema: parecian dos reproductores peleandose.
 *
 * Al acabar un capitulo de una serie aparece la tarjeta del siguiente (ver
 * `SiguienteEp`), y **antes hay que salirse de la pantalla completa**: el
 * reproductor del sistema se pinta fuera de la pagina y encima de el no se
 * puede dibujar nada, asi que una tarjeta en el DOM no se veria. Por eso aqui
 * la pregunta llega al terminar y no a mitad de los creditos como en la web:
 * salir de la pantalla completa a mitad de capitulo para preguntar algo seria
 * peor que no preguntarlo.
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
   * Nos hemos salido de la pantalla completa a proposito, para enseñar la
   * tarjeta del siguiente episodio.
   *
   * Hace falta porque salir de la pantalla completa es justo la señal con la
   * que este reproductor se cierra (el boton "Hecho" del sistema, el gesto de
   * atras). Sin esta marca, enseñar la tarjeta cerraria el reproductor y la
   * tarjeta con el.
   */
  const porLaTarjeta = useRef(false);
  const salirDePantallaCompleta = () => {
    const v = ref.current as unknown as { webkitExitFullscreen?: () => void } | null;
    porLaTarjeta.current = true;
    try {
      if (typeof v?.webkitExitFullscreen === 'function') v.webkitExitFullscreen();
      else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    } catch { /* ya estaba fuera */ }
  };

  const sig = useSiguiente({
    path, tmdbId,
    // En el telefono la tarjeta solo sale al final: encima del reproductor
    // del sistema no se puede dibujar.
    soloAlFinal: true,
    onVer: (siguiente) => {
      const v = ref.current;
      // El que se deja se marca visto antes de cambiar: si no, se quedaria a
      // medias en "Continuar viendo".
      if (v?.duration) {
        markWatched({ path, title, subtitle, poster, backdrop,
                      tmdb_id: tmdbId ?? null, media_type: mediaType,
                      position: v.duration, duration: v.duration });
      }
      porLaTarjeta.current = false;
      setPreparando(true);
      setActual((a) => ({ ...a, path: siguiente.path, subtitle: siguiente.label }));
    },
    onCerrar: onClose,
    pausar: () => ref.current?.pause(),
  });

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
      // Se pregunta que viene despues con tres minutos de margen, aunque la
      // tarjeta no se enseñe hasta el final: asi al acabar ya esta la
      // respuesta y no hay un hueco esperando a la red.
      sig.mirar(v.currentTime, v.duration);
      const now = Date.now(); if (now - last < 5000 || !v.duration) return; last = now;
      // Lo terminado se marca, no se borra: es lo que deja al servidor ofrecer
      // el episodio siguiente.
      if (v.currentTime / v.duration >= 0.97) markWatched(entrada());
      else setWatched(entrada());
    };
    const onEnded = () => {
      markWatched({ ...entrada(), position: v.duration || 0, duration: v.duration || 0 });
      // Si hay algo que preguntar, se sale de la pantalla completa (la unica
      // forma de que se vea la tarjeta) y el reproductor se queda abierto.
      if (sig.alTerminar()) { salirDePantallaCompleta(); return; }
      history.state?.player ? history.back() : close();
    };
    // El telefono no desmonta nada al bloquear la pantalla o cambiar de app:
    // sin esto se perdia justo el minuto por el que se dejo la pelicula.
    const onSalir = () => { if (v.duration && v.currentTime > 0) setWatched(entrada(), true); };
    const onOculta = () => { if (document.hidden) onSalir(); };

    let entered = false;
    const goFull = () => {
      if (entered) return; entered = true;
      // Si ya va por AirPlay no se entra en pantalla completa: la imagen esta
      // en la tele y lo unico que se veria aqui es el cartel de AirPlay.
      const anyAir = v as unknown as { webkitCurrentPlaybackTargetIsWireless?: boolean };
      if (anyAir.webkitCurrentPlaybackTargetIsWireless) { setPreparando(false); return; }
      // Ya hay imagen y el reproductor del sistema esta a punto de abrirse:
      // se retira la espera un instante despues para no dejar un parpadeo
      // del reproductor en linea entre medias.
      setTimeout(() => setPreparando(false), 120);
      const anyV = v as any;
      // iPhone: el reproductor del sistema. El resto: pantalla completa del
      // documento, con giro a apaisado donde se pueda bloquear.
      if (typeof anyV.webkitEnterFullscreen === 'function') { try { anyV.webkitEnterFullscreen(); } catch { /* hace falta un gesto */ } return; }
      const req = v.requestFullscreen?.bind(v) || anyV.webkitRequestFullscreen?.bind(v);
      if (req) req().then(() => (screen.orientation as any)?.lock?.('landscape').catch(() => {})).catch(() => {});
    };

    const onError = () => {
      setPreparando(false);
      setFallo('No se ha podido abrir el vídeo. Puede que el archivo no esté listo todavía.');
    };
    // Red de seguridad: si el vídeo no arranca (archivo a medio convertir, un
    // codec que el telefono no abre) mas vale ver el reproductor y sus
    // controles que quedarse en una espera eterna.
    const rendicion = setTimeout(() => setPreparando(false), 20000);

    // Salir de la pantalla completa (boton Hecho, atras) cierra el reproductor,
    // salvo que hayamos salido nosotros para enseñar la tarjeta del siguiente.
    const onExitIos = () => {
      if (porLaTarjeta.current) { porLaTarjeta.current = false; return; }
      history.state?.player ? history.back() : close();
    };
    const onFsChange = () => { if (entered && !document.fullscreenElement) onExitIos(); };
    const onPop = () => close();

    history.pushState({ player: true }, '');
    window.addEventListener('popstate', onPop);
    window.addEventListener('pagehide', onSalir);
    document.addEventListener('visibilitychange', onOculta);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('ended', onEnded);
    v.addEventListener('playing', goFull, { once: true });
    v.addEventListener('error', onError);
    v.addEventListener('webkitendfullscreen', onExitIos);
    document.addEventListener('fullscreenchange', onFsChange);

    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('pagehide', onSalir);
      document.removeEventListener('visibilitychange', onOculta);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('playing', goFull);
      v.removeEventListener('error', onError);
      clearTimeout(rendicion);
      v.removeEventListener('webkitendfullscreen', onExitIos);
      document.removeEventListener('fullscreenchange', onFsChange);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      (screen.orientation as any)?.unlock?.();
      // Si se cerro sin pasar por el historial (fin del video), se retira la entrada.
      if (history.state?.player) history.back();
      if (v.duration && v.currentTime > 0) setWatched(entrada(), true);
    };
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

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
