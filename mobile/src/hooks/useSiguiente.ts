/*
 * El motor de la tarjeta de «siguiente episodio».
 *
 * Es el mismo archivo en `frontend/`, `mobile/` y `tizen/`: los tres
 * reproductores son muy distintos por dentro (controles propios, el nativo
 * del telefono, el mando de la tele) pero *cuando* preguntar y *que* hacer
 * con la respuesta es idéntico, y eso es lo que vive aqui.
 *
 * Como se usa, desde el reproductor:
 *
 *   const sig = useSiguiente({ path, tmdbId, onVer, onCerrar });
 *   ...  en el `timeupdate`:  sig.mirar(v.currentTime, v.duration)
 *   ...  en el `ended`:       if (sig.alTerminar()) return;   // hay tarjeta
 *
 * Cuatro cosas que no son obvias:
 *
 * 1. **Se pregunta al servidor una sola vez por archivo.** `mirar()` se llama
 *    cuatro veces por segundo; sin el candado seria una peticion por
 *    fotograma. La respuesta sirve para los dos umbrales.
 * 2. **La tarjeta, una vez arriba, no cambia de tipo.** Se guarda en estado en
 *    vez de recalcularse en cada render: si no, al pedir una descarga la
 *    tarjeta se evaporaba (ya no quedaba nada que ofrecer) justo cuando
 *    acababa de aparecer el mensaje de que la descarga habia empezado.
 * 3. **La cuenta atras solo corre con la tarjeta de ver.** La de descargar no
 *    tiene cuenta atras a proposito: nada se baja sin que alguien lo pulse.
 * 4. **Al terminar el video la tarjeta se queda.** Si no, el reproductor se
 *    cerraria y la pregunta desapareceria justo cuando toca contestarla; por
 *    eso `alTerminar()` devuelve si hay algo que enseñar y el reproductor
 *    decide no cerrarse. Y si lo que se contesta es «descarga», al acabar ya
 *    no hay nada que ver: se cierra solo un segundo despues.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AVISO_BAJAR_S, AVISO_VER_S, CUENTA_ATRAS_S, bajarSiguientes, decidir, queViene,
  resumen, type Decision, type QueViene, type SiguienteEpisodio,
} from '../services/siguiente';

/** Lo que se queda el mensaje en pantalla antes de quitarse de en medio. */
const MENSAJE_MS = 2600;

export interface OpcionesSiguiente {
  path: string;
  tmdbId?: number | null;
  /** Poner el siguiente episodio. Lo decide el reproductor, que es quien sabe
   *  cambiar de archivo sin cerrarse. */
  onVer: (siguiente: SiguienteEpisodio) => void;
  /** Cerrar el reproductor. Se usa cuando el video ya ha terminado y la unica
   *  pregunta que habia (descargar) ya esta contestada. */
  onCerrar?: () => void;
  /** Pausar el video al enseñar la tarjeta. Opcional: en la web los creditos
   *  siguen corriendo por detras. */
  pausar?: () => void;
  /**
   * No enseñar nada hasta que el video acabe; solo adelantar la consulta.
   *
   * Es lo que necesita el movil: ahi se reproduce con el reproductor del
   * sistema a pantalla completa, y **encima de eso no se puede dibujar
   * nada** (el `<video>` nativo de iOS se pinta fuera de la pagina). Sacar la
   * tarjeta a mitad de capitulo obligaria a salirse de la pantalla completa,
   * que es peor que la propia espera. Asi que alli la pregunta llega al
   * terminar, que es cuando se puede ver.
   */
  soloAlFinal?: boolean;
}

export interface EstadoSiguiente {
  /** Que tarjeta dibujar, o `{ tipo: 'nada' }`. */
  decision: Decision;
  /** De 0 a 1: lo que lleva la barra de la cuenta atras. */
  progreso: number;
  /** Segundos que faltan para pasar solo, para escribirlo en el boton. */
  restante: number;
  /** Si la cuenta atras esta corriendo. */
  corriendo: boolean;
  /**
   * El video ya ha terminado y la tarjeta es lo unico que queda en pantalla.
   *
   * Lo usa la tele para saber si la tarjeta puede quedarse con el mando: con
   * el capitulo todavia corriendo no puede, porque las flechas son el salto
   * de 10 s y OK es la pausa. Mientras hay video hay que entrar en la tarjeta
   * a proposito (▼); cuando ya no hay, el mando es suyo.
   */
  alFinal: boolean;
  bajando: boolean;
  /** Lo que ha pasado al pulsar descargar. Vacio si no se ha pulsado. */
  mensaje: string;
  titulo: string;
  poster?: string | null;
  backdrop?: string | null;
  mirar: (tiempo: number, duracion: number) => void;
  alTerminar: () => boolean;
  ver: () => void;
  descargar: () => void;
  descartar: () => void;
  /** Parar la cuenta atras sin cerrar la tarjeta (al pasar el raton por encima
   *  o al mover el mando: si alguien esta ahi, no se le quita de delante). */
  parar: () => void;
}

const SIN_NADA: Decision = { tipo: 'nada' };

export function useSiguiente({ path, tmdbId, onVer, onCerrar, pausar,
                               soloAlFinal }: OpcionesSiguiente): EstadoSiguiente {
  const [datos, setDatos] = useState<QueViene | null>(null);
  const [tarjeta, setTarjeta] = useState<Decision>(SIN_NADA);
  const [progreso, setProgreso] = useState(0);
  const [corriendo, setCorriendo] = useState(false);
  const [bajando, setBajando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [alFinal, setAlFinal] = useState(false);

  // Un candado por archivo: `mirar()` se llama en cada timeupdate y la
  // peticion es una, no una por fotograma.
  const pedido = useRef<string | null>(null);
  const datosRef = useRef<QueViene | null>(null);
  const descartada = useRef(false);
  const terminado = useRef(false);
  datosRef.current = datos;

  // Lo ultimo que se sabe de las funciones del reproductor, para que los
  // callbacks de aqui no se recreen en cada render del padre (es lo que tuvo
  // al reproductor de la tele reanudando en bucle, ver tizen/Player.tsx).
  const ultimas = useRef({ onVer, onCerrar, pausar });
  ultimas.current = { onVer, onCerrar, pausar };

  // Al cambiar de archivo se olvida todo: la tarjeta del episodio anterior no
  // tiene nada que decir sobre el nuevo.
  useEffect(() => {
    setDatos(null);
    setTarjeta(SIN_NADA);
    setProgreso(0);
    setCorriendo(false);
    setBajando(false);
    setMensaje('');
    setAlFinal(false);
    pedido.current = null;
    descartada.current = false;
    terminado.current = false;
  }, [path]);

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
    if (soloAlFinal) return;   // la consulta ya esta hecha; la tarjeta espera
    const d = decidir(datosRef.current);
    if (d.tipo === 'nada') return;
    // Lo que se puede ver se ofrece pegado a los creditos; lo que hay que
    // descargar, en cuanto se sabe, porque bajar un capitulo tarda.
    if (d.tipo === 'ver' && quedan > AVISO_VER_S) return;
    setTarjeta((actual) => (actual.tipo === 'nada' ? d : actual));
  }, [path, tmdbId, soloAlFinal]);

  // La tarjeta de ver trae cuenta atras; la de descargar, no.
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

  const ver = useCallback(() => {
    const d = tarjeta;
    if (d.tipo !== 'ver') return;
    setCorriendo(false);
    setTarjeta(SIN_NADA);
    setProgreso(0);
    ultimas.current.onVer(d.siguiente);
  }, [tarjeta]);

  // El salto se dispara desde un efecto y no desde el intervalo: llamar a
  // `ver()` dentro del propio setState dejaria el render a medias.
  useEffect(() => {
    if (corriendo && progreso >= 1) ver();
  }, [corriendo, progreso, ver]);

  const descargar = useCallback(() => {
    setCorriendo(false);
    setBajando(true);
    setMensaje('');
    bajarSiguientes(path, tmdbId).then((r) => {
      setBajando(false);
      setMensaje(resumen(r));
      // Lo que se acaba de pedir ya no se vuelve a ofrecer: si no, la tarjeta
      // seguiria proponiendo descargar el 3x09 con el 3x09 bajando.
      setTarjeta((d) => (d.tipo === 'nada' ? d : { ...d, bajar: [] }));
      setDatos((d) => (d ? { ...d, descargables: [] } : d));
      setTimeout(() => {
        setMensaje('');
        setTarjeta((d) => {
          // Si la tarjeta era la de descargar, ya no queda nada que preguntar.
          if (d.tipo !== 'bajar') return d;
          if (terminado.current) ultimas.current.onCerrar?.();
          return SIN_NADA;
        });
      }, MENSAJE_MS);
    });
  }, [path, tmdbId]);

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
    setAlFinal(true);
    // El video ha acabado y hay algo que preguntar: se pausa (donde eso tiene
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
    alFinal,
    bajando,
    mensaje,
    titulo: datos?.title || '',
    poster: datos?.poster,
    backdrop: datos?.backdrop,
    mirar,
    alTerminar,
    ver,
    descargar,
    descartar,
    parar,
  };
}
