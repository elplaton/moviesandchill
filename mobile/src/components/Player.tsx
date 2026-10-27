import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { audioLabel, fetchTracks, pistasNativas, streamTicket, subtitleUrl,
         type AudioTrack, type ExternalSubtitle } from '../services/tracks';
import { useAirplay } from '../hooks/useAirplay';
import { IAirplay, ICheck, IClose } from './Icons';
import { markWatched, resumePoint, setWatched } from '../utils/progress';
import { useSiguiente } from '../hooks/useSiguiente';
import SiguienteEp from './SiguienteEp';
import { useFuente } from '../hooks/useFuente';
import { comoAbrirHls } from '../services/reproducir';

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
 * Mientras carga se tapa con una pantalla de espera —carátula, título y un
 * indicador girando— y nada mas: sin ella se ve un instante el poster con los
 * controles encima antes de que arranque la imagen. **No hay pantalla de
 * error**, a proposito: ver `onError`.
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
  const [pistas, setPistas] = useState<{ audio: AudioTrack[]; porDefecto: number | null }>(
    { audio: [], porDefecto: null });
  const [preparando, setPreparando] = useState(true);
  const airplay = useAirplay(ref);

  /**
   * Si se ve la barra de arriba (cerrar + titulo).
   *
   * Se esconde sola, igual que los controles del video: antes se quedaba
   * puesta toda la pelicula, tapando una esquina de la imagen. No hay forma de
   * preguntarle a iOS si sus controles estan visibles, asi que se hace lo
   * mismo que hacen ellos —asomar al tocar la pantalla y retirarse a los
   * cuatro segundos—, que es lo que deja las dos cosas mas o menos a la vez.
   * Con la barra escondida, un toque la devuelve, que es por donde se cierra.
   */
  const [barra, setBarra] = useState(true);
  const relojBarra = useRef(0);
  // Con el menu de idioma abierto no se arma el reloj: cada toque dentro del
  // menu pasa por aqui, y la barra se iria con el menu a medio elegir.
  const menuAbierto = useRef(false);
  const asomar = useCallback(() => {
    setBarra(true);
    window.clearTimeout(relojBarra.current);
    if (menuAbierto.current) return;
    relojBarra.current = window.setTimeout(() => setBarra(false), 4000);
  }, []);
  useEffect(() => () => window.clearTimeout(relojBarra.current), []);

  /**
   * El idioma del audio, que es cosa nuestra y no del reproductor del sistema.
   *
   * Se confiaba en el selector nativo y no basta: Chrome no implementa
   * `audioTracks` (suena siempre la primera pista, y el reproductor de Android
   * no deja cambiarla), y la version adaptada (HLS) solo lleva una pista, asi
   * que viendo sin descargar ni el iPhone tiene a cual cambiar. Donde el
   * navegador si deja y se esta viendo el archivo tal cual, se cambia en
   * caliente; en el resto se pide al servidor la version adaptada con esa
   * pista (`useFuente` con `audio`) y se vuelve al mismo punto.
   *
   * Va atado a la ruta, como el modo de `useFuente`: al pasar al siguiente
   * episodio se olvida solo, y ese empieza con su pista de siempre.
   */
  const [elegido, setElegido] = useState<{ path: string; audio: number } | null>(null);
  const audio = elegido?.path === path ? elegido.audio : null;
  // La pista activa cuando se ha cambiado en caliente (sin recargar nada).
  const [enCaliente, setEnCaliente] = useState<{ path: string; audio: number } | null>(null);
  const [menu, setMenu] = useState(false);
  menuAbierto.current = menu;
  // Si este aparato sabe abrir la version adaptada: sin eso, cambiar de pista
  // solo se puede donde el navegador lo hace por si mismo.
  const [porHls, setPorHls] = useState(false);
  useEffect(() => {
    let vivo = true;
    comoAbrirHls().then(m => { if (vivo) setPorHls(m !== 'directo'); });
    return () => { vivo = false; };
  }, []);

  /**
   * A donde hay que volver cuando llegue la fuente con el idioma nuevo, y si
   * estaba en marcha. Mientras esta puesto, el <video> esta recargando y su
   * `currentTime` (cero) no es por donde va la pelicula: el guardado del
   * progreso y la pregunta del siguiente episodio usan esto en su lugar, o
   * cambiar de idioma dejaria «Continuar viendo» al principio.
   */
  const salto = useRef<{ t: number; seguir: boolean } | null>(null);
  const rendicionIdioma = useRef(0);
  useEffect(() => () => window.clearTimeout(rendicionIdioma.current), []);

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
  // Viendo sin descargar, lo que el aparato no abre tal cual (un MKV en el
  // iPhone, el audio AC-3/DTS en cualquier navegador) se pide en la version
  // que el servidor adapta al vuelo (HLS). Lo decide `useFuente`.
  const src = useFuente(ref, path, ticket, audio);

  // El selector de subtítulos lo pone el reproductor del sistema; aquí solo
  // hay que colgarle las pistas que haya.
  useEffect(() => {
    let vivo = true;
    // La entrada del episodio anterior **no vale para este archivo**
    // (`create_stream_token()` la limita a una ruta), asi que al cambiar de
    // episodio se olvida en vez de reaprovecharla: con la vieja el servidor
    // contesta 401 y el <video> suelta un error que no significa nada.
    setTicket(null);
    setSubs([]);
    setPistas({ audio: [], porDefecto: null });
    setMenu(false);
    window.clearTimeout(rendicionIdioma.current);
    streamTicket(path).then(t => { if (vivo) setTicket(t); });
    fetchTracks(path).then(p => {
      if (!vivo) return;
      setSubs(p.external_subtitles);
      setPistas({ audio: p.audio, porDefecto: p.default_audio });
    });
    return () => { vivo = false; };
  }, [path]);

  useEffect(() => {
    const v = ref.current; if (!v) return;
    // El punto de reanudacion lo da el servidor, asi que llega tarde: puede
    // resolverse antes o despues de que el video tenga metadatos. Lo aplica el
    // que llegue el ultimo de los dos, y una sola vez.
    //
    // Un cambio de idioma recarga la fuente y trae otro `loadedmetadata`: ese
    // es del salto al punto donde se estaba (`salto`), no de la reanudacion.
    // Si la reanudacion aun no habia llegado, ya no se aplica: lo que manda
    // es donde estaba viendo, no donde lo dejo la ultima vez.
    salto.current = null;
    let inicio = -1;
    let saltado = false;
    const aplicarInicio = () => {
      if (inicio <= 0 || !v.duration) return;
      v.currentTime = inicio;
      inicio = -1;
    };
    resumePoint(path).then((s) => {
      if (saltado || salto.current) return;
      inicio = s;
      if (v.readyState >= 1) aplicarInicio();
    });
    let last = 0;
    let closed = false;
    const close = () => { if (closed) return; closed = true; onClose(); };

    const entrada = () => ({ path, title, subtitle, poster, backdrop,
                             tmdb_id: tmdbId ?? null, media_type: mediaType,
                             position: salto.current?.t ?? v.currentTime, duration: v.duration });
    const onMeta = () => {
      const s = salto.current;
      if (!s) { aplicarInicio(); return; }
      salto.current = null;
      saltado = true;
      inicio = -1;
      if (s.t > 0) v.currentTime = s.t;
      // `autoPlay` arranca la fuente nueva sola: si estaba en pausa se para.
      if (s.seguir) v.play().catch(() => {});
      else v.pause();
    };
    const onTime = () => {
      // Recargando por un cambio de idioma el tiempo es el de la fuente nueva
      // antes del salto (cero): ni se guarda ni se pregunta nada con el.
      if (salto.current) return;
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
      // Un `ended` lejos del final no es el final: es que el tramo de video
      // llego mas corto de lo prometido (pasa al ver sin descargar, si
      // Telegram corta a mitad de un salto). Antes eso cerraba el reproductor
      // y encima marcaba la pelicula como vista; ahora se vuelve a pedir ese
      // punto y se sigue.
      if (v.duration && isFinite(v.duration) && v.currentTime < v.duration - 15) {
        const t = v.currentTime;
        v.currentTime = Math.max(0, t - 1);
        v.play().catch(() => {});
        return;
      }
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

    /**
     * Un `error` del <video> **no es prueba de que el video no se pueda ver**,
     * y por eso aqui ya no se pinta ningun aviso.
     *
     * El elemento se inserta en la pagina antes de tener `src`, porque la
     * entrada de reproduccion es un viaje al servidor; y un <video> sin fuente
     * dispara un `error` el solo en cuanto entra en el documento (el algoritmo
     * de seleccion de recurso no encuentra candidato y pone
     * MEDIA_ERR_SRC_NOT_SUPPORTED). Con eso se pintaba «No se ha podido abrir
     * el video» **encima de una pelicula que se estaba reproduciendo
     * perfectamente**: no se notaba mientras el reproductor del sistema tapaba
     * la pagina entera, y al pasar a reproducir dentro de ella quedo a la
     * vista y sin forma de quitarlo. De ahi la guarda del `src`.
     *
     * Lo unico que se hace es retirar la espera. Si el archivo de verdad no se
     * abre, lo dice el reproductor del sistema con su propio icono, que es la
     * unica señal que no puede equivocarse.
     */
    const onError = () => { if (v.getAttribute('src')) setPreparando(false); };
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
    v.addEventListener('canplay', onPlaying);
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
      v.removeEventListener('canplay', onPlaying);
      v.removeEventListener('error', onError);
      clearTimeout(rendicion);
      v.removeEventListener('webkitendfullscreen', onExitIos);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      // Si se cerro sin pasar por el historial (fin del video), se retira la entrada.
      if (history.state?.player) history.back();
      if (v.duration && v.currentTime > 0) setWatched(entrada(), true);
    };
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mientras se prepara el video la espera lo tapa todo; en cuanto se retira
  // la barra asoma una vez y se va sola, para que se vea que esta ahi.
  useEffect(() => { if (!preparando) asomar(); }, [preparando, asomar]);

  const cerrar = () => { history.state?.player ? history.back() : onClose(); };

  // Con el menu abierto la barra no se va: se esconderia el menu con ella. Al
  // cerrarlo vuelve a contar el reloj de siempre.
  const abrirMenu = () => {
    menuAbierto.current = true;
    window.clearTimeout(relojBarra.current);
    setBarra(true);
    setMenu(true);
  };
  const cerrarMenu = () => { menuAbierto.current = false; setMenu(false); asomar(); };

  const directa = !!src && src.startsWith('/api/stream');
  const nativas = directa ? pistasNativas(ref.current) : null;
  /** La pista que suena ahora. La elegida, si la hay; si no, la que pone el
   *  servidor en la version adaptada o, tal cual, la que marca el navegador
   *  (Chrome, que no las expone, toca la marcada por defecto o la primera). */
  const activa = (() => {
    if (audio !== null) return audio;
    if (enCaliente?.path === path) return enCaliente.audio;
    if (!directa) return pistas.porDefecto ?? 0;
    if (nativas) {
      for (let i = 0; i < nativas.length; i++) if (nativas[i].enabled) return i;
    }
    const marcada = pistas.audio.find(a => a.default);
    return marcada ? marcada.order : 0;
  })();
  // Solo si hay entre que elegir y alguna forma de cambiar. Durante AirPlay
  // no: quien lee el video es el Apple TV y recargar la fuente lo dejaria
  // colgado; ademas el aviso de AirPlay tapa la pantalla.
  const hayIdiomas = pistas.audio.length > 1 && (porHls || !!nativas) && !airplay.activo;

  const elegirAudio = (order: number) => {
    cerrarMenu();
    const v = ref.current;
    if (!v || order === activa) return;
    // Viendo el archivo tal cual, donde el navegador deja (Safari), se cambia
    // en caliente: ni recarga ni pierde un segundo.
    if (nativas && order < nativas.length) {
      for (let i = 0; i < nativas.length; i++) nativas[i].enabled = i === order;
      setEnCaliente({ path, audio: order });
      return;
    }
    if (!porHls) return;
    // En el resto, otra fuente con esa pista. Se apunta por donde iba (si ya
    // habia un salto pendiente, ese es el bueno: el <video> aun no ha llegado)
    // y se vuelve ahi en cuanto lleguen los metadatos (ver `onMeta`).
    salto.current = salto.current ?? { t: v.currentTime, seguir: !v.paused };
    setPreparando(true);
    window.clearTimeout(rendicionIdioma.current);
    rendicionIdioma.current = window.setTimeout(() => setPreparando(false), 20000);
    setElegido({ path, audio: order });
  };

  return createPortal(
    <div className="player-shell" onTouchStart={asomar}>
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
      {!preparando && (
        <div className={`absolute top-0 inset-x-0 flex items-start gap-3 p-4 pt-[max(1rem,env(safe-area-inset-top))]
                        pointer-events-none bg-gradient-to-b from-black/70 to-transparent
                        transition-opacity duration-200 ${barra || menu ? 'opacity-100' : 'opacity-0'}`}>
          <button onClick={cerrar} aria-label="Cerrar"
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black/50 active:bg-white/20
                        ${barra || menu ? 'pointer-events-auto' : ''}`}>
            <span className="w-5 h-5"><IClose /></span>
          </button>
          <div className="min-w-0 flex-1 pt-1">
            <p className="truncate text-[15px] font-semibold leading-tight">{title}</p>
            {subtitle && <p className="truncate text-[13px] text-nf-text2">{subtitle}</p>}
          </div>
          {hayIdiomas && (
            <button onClick={() => (menu ? cerrarMenu() : abrirMenu())} aria-label="Idioma del audio"
              aria-expanded={menu}
              className={`h-10 shrink-0 rounded-full bg-black/50 px-4 text-[14px] font-semibold active:bg-white/20
                          ${barra || menu ? 'pointer-events-auto' : ''}`}>
              Idioma
            </button>
          )}
        </div>
      )}

      {/* La lista de idiomas, debajo del boton. El fondo transparente de detras
          es para cerrarla tocando fuera sin que ese toque llegue al video (que
          lo tomaria como pausa). */}
      {menu && hayIdiomas && !preparando && (
        <div className="absolute inset-0 z-20" onClick={cerrarMenu}>
          <div onClick={e => e.stopPropagation()}
            className="absolute right-4 top-[calc(max(1rem,env(safe-area-inset-top))+3rem)] w-64 max-w-[calc(100%-2rem)]
                       max-h-[60%] overflow-y-auto rounded-2xl bg-black/90 py-2 backdrop-blur">
            <p className="px-4 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-nf-text3">Audio</p>
            {pistas.audio.map(a => (
              <button key={a.order} onClick={() => elegirAudio(a.order)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-[15px] active:bg-white/10">
                <span className={`h-4 w-4 shrink-0 ${a.order === activa ? 'text-nf-red' : 'opacity-0'}`}><ICheck /></span>
                <span className={`min-w-0 truncate ${a.order === activa ? 'font-semibold' : ''}`}>{audioLabel(a)}</span>
              </button>
            ))}
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

      {preparando && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
          {backdrop && (
            <img src={backdrop} alt="" className="absolute inset-0 w-full h-full object-cover opacity-25" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/80 to-black/60" />
          <div className="relative">
            <span className="block w-10 h-10 mx-auto rounded-full border-[3px] border-white/20 border-t-white animate-spin" />
            <p className="mt-5 text-[17px] font-semibold leading-tight">{title}</p>
            {subtitle && <p className="mt-1 text-[14px] text-nf-text2">{subtitle}</p>}
            {airplay.disponible && (
              <button onClick={airplay.elegir}
                className="mt-6 inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-white/15 text-[15px] font-semibold active:bg-white/25">
                <span className="w-5 h-5"><IAirplay /></span>
                Ver en otra pantalla
              </button>
            )}
          </div>
        </div>
      )}

    </div>,
    document.body,
  );
}
