/*
 * El motor de la tarjeta de «siguiente episodio».
 *
 * Es el mismo archivo en `frontend/`, `mobile/` y `tizen/`: los tres
 * reproductores son muy distintos por dentro (controles propios, el del
 * teléfono, el mando de la tele) pero *cuándo* preguntar y *qué* hacer con la
 * respuesta es idéntico, y eso es lo que vive aquí.
 *
 * Cómo se usa, desde el reproductor:
 *
 *   const sig = useSiguiente({ path, tmdbId, onVer, onCerrar });
 *   ...  en el `timeupdate`:  sig.mirar(v.currentTime, v.duration)
 *   ...  en el `ended`:       if (sig.alTerminar()) return;   // hay tarjeta
 *
 * **Una sola acción.** Ver el siguiente y dejar bajando el de después no son
 * dos botones, son uno: «Ver 3x08 y descargar 3x09». Empezaron siendo dos y
 * se pidió juntarlos, y tiene sentido: en ese momento nadie está eligiendo
 * entre dos cosas, está diciendo «sigue». La barra que avanza sola es ese
 * mismo botón pulsándose solo, así que al llenarse hace exactamente lo que
 * pone —por eso el texto lleva los números de episodio escritos—. Y por eso
 * mismo la tarjeta de descargar a secas **no tiene barra**: lo que puede pasar
 * sin que nadie toque nada es seguir viendo, no empezar una descarga de tres
 * gigas por su cuenta.
 *
 * Cuatro cosas más que no son obvias:
 *
 * 1. **Se pregunta al servidor una sola vez por archivo.** `mirar()` se llama
 *    cuatro veces por segundo; sin el candado sería una petición por
 *    fotograma. La respuesta sirve para los dos umbrales.
 * 2. **La tarjeta, una vez arriba, no cambia de tipo.** Se guarda en estado en
 *    vez de recalcularse en cada render: si no, al pedir una descarga la
 *    tarjeta se evaporaba (ya no quedaba nada que ofrecer) justo cuando
 *    acababa de aparecer el mensaje de que la descarga había empezado.
 * 3. **El mensaje sobrevive al cambio de episodio.** Es lo único que lo hace:
 *    al pulsar «ver y descargar» el reproductor cambia de archivo al instante
 *    y todo lo demás se reinicia, así que si el aviso se fuera con ello nadie
 *    llegaría a leer que la descarga ha empezado.
 * 4. **Al terminar el vídeo la tarjeta se queda.** Si no, el reproductor se
 *    cerraría y la pregunta desaparecería justo cuando toca contestarla; por
 *    eso `alTerminar()` devuelve si hay algo que enseñar y el reproductor
 *    decide no cerrarse. Y si lo que se contesta es «descarga», al acabar ya
 *    no hay nada que ver: se cierra solo un segundo después.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AVISO_BAJAR_S, AVISO_VER_S, CUENTA_ATRAS_S, bajarSiguientes, decidir, listar, queViene,
  resumen, type Decision, type QueViene, type SiguienteEpisodio,
} from '../services/siguiente';

/** Lo que se queda el mensaje en pantalla antes de quitarse de en medio. */
const MENSAJE_MS = 3200;

export interface OpcionesSiguiente {
  path: string;
  tmdbId?: number | null;
  /** Poner el siguiente episodio. Lo decide el reproductor, que es quien sabe
   *  cambiar de archivo sin cerrarse. */
  onVer: (siguiente: SiguienteEpisodio) => void;
  /** Cerrar el reproductor. Se usa cuando el vídeo ya ha terminado y la única
   *  pregunta que había (descargar) ya está contestada. */
  onCerrar?: () => void;
  /** Pausar el vídeo al enseñar la tarjeta. Opcional: mientras quede vídeo los
   *  créditos siguen corriendo por detrás, que es lo que se quiere. */
  pausar?: () => void;
}

export interface EstadoSiguiente {
  /** Qué tarjeta dibujar, o `{ tipo: 'nada' }`. */
  decision: Decision;
  /** De 0 a 1: lo que lleva la barra de la cuenta atrás. */
  progreso: number;
  /** Segundos que faltan para que se pulse sola, para escribirlo en el botón. */
  restante: number;
  /** Si la cuenta atrás está corriendo. */
  corriendo: boolean;
  /**
   * El vídeo ya ha terminado y la tarjeta es lo único que queda en pantalla.
   *
   * Lo usa la tele para saber si la tarjeta puede quedarse con el mando: con
   * el capítulo todavía corriendo no puede, porque las flechas son el salto
   * de 10 s y OK es la pausa. Mientras hay vídeo hay que entrar en la tarjeta
   * a propósito (▼); cuando ya no hay, el mando es suyo.
   */
  alFinal: boolean;
  bajando: boolean;
  /** Lo que ha pasado al pedir la descarga. Vacío si no se ha pedido. */
  mensaje: string;
  titulo: string;
  poster?: string | null;
  backdrop?: string | null;
  /** Lo que pone el botón, que es también lo que hace. */
  texto: string;
  mirar: (tiempo: number, duracion: number) => void;
  alTerminar: () => boolean;
  /** La única acción: ver el siguiente y/o dejar bajando lo que venga. */
  confirmar: () => void;
  descartar: () => void;
  /** Parar la cuenta atrás sin cerrar la tarjeta (al pasar el ratón por encima,
   *  al tocar la pantalla o al mover el mando: si alguien está ahí, no se le
   *  cambia de capítulo en medio). */
  parar: () => void;
}

const SIN_NADA: Decision = { tipo: 'nada' };

/**
 * Lo que pone el botón, que es también lo que hace.
 *
 * Se escribe entero —con los números de episodio— en vez de un «Siguiente»
 * genérico porque es lo que se va a pulsar solo: si la barra llega al final y
 * arranca una descarga, tiene que haber estado dicho por delante qué iba a
 * pasar.
 */
export function textoDe(d: Decision): string {
  if (d.tipo === 'ver') {
    return d.bajar.length
      ? `Ver ${d.siguiente.label} y descargar ${listar(d.bajar)}`
      : `Ver ${d.siguiente.label}`;
  }
  if (d.tipo === 'bajar') return `Descargar ${listar(d.bajar)}`;
  return '';
}

export function useSiguiente({ path, tmdbId, onVer, onCerrar, pausar }: OpcionesSiguiente): EstadoSiguiente {
  const [datos, setDatos] = useState<QueViene | null>(null);
  const [tarjeta, setTarjeta] = useState<Decision>(SIN_NADA);
  const [progreso, setProgreso] = useState(0);
  const [corriendo, setCorriendo] = useState(false);
  const [bajando, setBajando] = useState(false);
  const [mensaje, setMensaje] = useState('');

  // Un candado por archivo: `mirar()` se llama en cada timeupdate y la
  // petición es una, no una por fotograma.
  const pedido = useRef<string | null>(null);
  const datosRef = useRef<QueViene | null>(null);
  const descartada = useRef(false);
  const terminado = useRef(false);
  const avisoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  datosRef.current = datos;

  // Lo último que se sabe de las funciones del reproductor, para que los
  // callbacks de aquí no se recreen en cada render del padre (es lo que tuvo
  // al reproductor de la tele reanudando en bucle, ver tizen/Player.tsx).
  const ultimas = useRef({ onVer, onCerrar, pausar });
  ultimas.current = { onVer, onCerrar, pausar };

  // Al cambiar de archivo se olvida todo **menos el mensaje**: al pulsar «ver
  // y descargar» el episodio cambia al instante, y si el aviso se fuera con
  // él nadie llegaría a leer que la descarga ha empezado. Se va solo, con su
  // propio temporizador.
  useEffect(() => {
    setDatos(null);
    setTarjeta(SIN_NADA);
    setProgreso(0);
    setCorriendo(false);
    setBajando(false);
    pedido.current = null;
    descartada.current = false;
    terminado.current = false;
  }, [path]);

  useEffect(() => () => { if (avisoTimer.current) clearTimeout(avisoTimer.current); }, []);

  const avisar = useCallback((texto: string) => {
    setMensaje(texto);
    if (avisoTimer.current) clearTimeout(avisoTimer.current);
    avisoTimer.current = setTimeout(() => setMensaje(''), MENSAJE_MS);
  }, []);

  const mirar = useCallback((tiempo: number, duracion: number) => {
    if (!duracion || !isFinite(duracion) || descartada.current) return;
    const quedan = duracion - tiempo;
    if (quedan > AVISO_BAJAR_S) return;

    if (pedido.current !== path) {
      pedido.current = path;
      queViene(path, tmdbId).then((q) => {
        // La respuesta puede llegar cuando ya se ha cambiado de archivo.
        if (pedido.current === path) setDatos(q);
      });
      return;
    }
    const d = decidir(datosRef.current);
    if (d.tipo === 'nada') return;
    // Lo que se puede ver se ofrece pegado a los créditos; lo que hay que
    // descargar, en cuanto se sabe, porque bajar un capítulo tarda.
    if (d.tipo === 'ver' && quedan > AVISO_VER_S) return;
    setTarjeta((actual) => (actual.tipo === 'nada' ? d : actual));
  }, [path, tmdbId]);

  // La cuenta atrás es el botón pulsándose solo, así que solo corre cuando lo
  // que va a hacer incluye ver algo.
  useEffect(() => {
    if (tarjeta.tipo === 'ver') { setProgreso(0); setCorriendo(true); }
    else setCorriendo(false);
  }, [tarjeta]);

  useEffect(() => {
    if (!corriendo) return;
    const paso = 100;
    const t = setInterval(() => {
      setProgreso((p) => Math.min(1, p + paso / (CUENTA_ATRAS_S * 1000)));
    }, paso);
    return () => clearInterval(t);
  }, [corriendo]);

  /**
   * La única acción de la tarjeta: lo que diga el botón.
   *
   * Si hay episodio que ver **y** algo que bajar se hacen las dos cosas: la
   * descarga se lanza sin esperarla y el cambio de episodio va inmediato,
   * porque hacer esperar a que el servidor conteste para poner el capítulo
   * siguiente sería justo lo contrario de lo que se busca aquí.
   */
  const confirmar = useCallback(() => {
    const d = tarjeta;
    if (d.tipo === 'nada') return;
    setCorriendo(false);

    if (d.bajar.length) {
      setBajando(true);
      bajarSiguientes(path, tmdbId).then((r) => {
        setBajando(false);
        avisar(resumen(r));
        setDatos((x) => (x ? { ...x, descargables: [] } : x));
        // Si la tarjeta era solo de descargar, al acabar el vídeo ya no queda
        // nada que hacer aquí: se cierra el reproductor en cuanto se lee.
        if (d.tipo === 'bajar') {
          setTimeout(() => { if (terminado.current) ultimas.current.onCerrar?.(); }, MENSAJE_MS);
        }
      });
    }

    if (d.tipo === 'ver') {
      setTarjeta(SIN_NADA);
      setProgreso(0);
      ultimas.current.onVer(d.siguiente);
    } else {
      // La tarjeta se queda puesta pero sin nada que ofrecer: es donde se lee
      // el «Descargando 3x09 y 3x10».
      setTarjeta({ ...d, bajar: [] });
    }
  }, [tarjeta, path, tmdbId, avisar]);

  // El salto se dispara desde un efecto y no desde el intervalo: llamar a
  // `confirmar()` dentro del propio setState dejaría el render a medias.
  useEffect(() => {
    if (corriendo && progreso >= 1) confirmar();
  }, [corriendo, progreso, confirmar]);

  const descartar = useCallback(() => {
    descartada.current = true;
    setCorriendo(false);
    setTarjeta(SIN_NADA);
    if (terminado.current) ultimas.current.onCerrar?.();
  }, []);

  const parar = useCallback(() => setCorriendo(false), []);

  const alTerminar = useCallback(() => {
    const d = decidir(datosRef.current);
    if (descartada.current || d.tipo === 'nada') return false;
    terminado.current = true;
    // El vídeo ha acabado y hay algo que preguntar: se pausa (donde eso tiene
    // sentido) y se enseña la tarjeta en vez de cerrar el reproductor.
    ultimas.current.pausar?.();
    setTarjeta((actual) => (actual.tipo === 'nada' ? d : actual));
    return true;
  }, []);

  return {
    decision: tarjeta,
    progreso,
    restante: Math.max(0, Math.ceil(CUENTA_ATRAS_S * (1 - progreso))),
    corriendo,
    alFinal: terminado.current,
    bajando,
    mensaje,
    titulo: datos?.title || '',
    poster: datos?.poster,
    backdrop: datos?.backdrop,
    texto: textoDe(tarjeta),
    mirar,
    alTerminar,
    confirmar,
    descartar,
    parar,
  };
}
