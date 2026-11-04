/*
 * Volver a pedir el vídeo cuando no llega a arrancar.
 *
 * Es el mismo archivo en `frontend/`, `mobile/` y `tizen/`.
 *
 * Pasaba sobre todo al pulsar «Siguiente episodio» viendo sin descargar: el
 * servidor tiene que pedir a Telegram el archivo nuevo y, si va por la versión
 * adaptada, arrancar ffmpeg; si eso tarda o falla una vez, el `<video>` (o
 * hls.js) se rendía y la pantalla se quedaba en negro hasta salir y volver a
 * entrar, que es justo lo que este hook hace solo. En hls.js era peor: ante un
 * fallo de la lista inicial se llamaba a `startLoad()`, que no la vuelve a
 * pedir, así que no se recuperaba nunca.
 *
 * Solo mientras el vídeo **no ha arrancado**: un fallo en mitad de la película
 * es otra cosa (y el `<video>` ya reintenta los tramos por su cuenta). Cada
 * intento cambia la URL (`&intento=N`, el servidor lo ignora) para que el
 * `<video>` y hls.js la pidan de nuevo, y si ya se había saltado al punto
 * donde se dejó, se vuelve a él.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** Las esperas entre intentos: cuatro, unos 17 s en total. */
const ESPERAS_MS = [1500, 3000, 5000, 8000];

export interface Reintento {
  /** Cuántas veces se ha vuelto a pedir este archivo (0 = la primera). */
  intento: number;
  /** Para lo que falla sin pasar por el `error` del `<video>` (hls.js). */
  fallo: () => void;
  /** Si el fallo de ahora se va a reintentar: el reproductor no debe avisar
   *  de un error que se va a arreglar solo en unos segundos. */
  vaAReintentar: () => boolean;
}

export function useReintento(ref: RefObject<HTMLVideoElement>, path: string): Reintento {
  const [estado, setEstado] = useState({ path, intento: 0 });
  const intento = estado.path === path ? estado.intento : 0;
  const intentoRef = useRef(intento);
  intentoRef.current = intento;
  const arrancado = useRef(false);
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Donde iba al fallar, para volver ahi con la fuente nueva.
  const donde = useRef(0);

  useEffect(() => {
    arrancado.current = false;
    donde.current = 0;
    return () => {
      if (espera.current) clearTimeout(espera.current);
      espera.current = null;
    };
  }, [path]);

  const vaAReintentar = useCallback(
    () => !arrancado.current && intentoRef.current < ESPERAS_MS.length, []);

  const fallo = useCallback(() => {
    if (!vaAReintentar() || espera.current) return;
    const n = intentoRef.current;
    const t = ref.current?.currentTime || 0;
    if (t > 1) donde.current = t;
    espera.current = setTimeout(() => {
      espera.current = null;
      setEstado({ path, intento: n + 1 });
    }, ESPERAS_MS[n]);
  }, [path, ref, vaAReintentar]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const onPlaying = () => { arrancado.current = true; };
    // Sin `src` todavia (esperando a la entrada o al modo) un `error` no dice
    // nada del archivo: un `<video>` sin fuente lo suelta el solo.
    const onError = () => { if (v.error && v.getAttribute('src')) fallo(); };
    const onMeta = () => {
      if (donde.current > 1) { v.currentTime = donde.current; donde.current = 0; }
    };
    v.addEventListener('playing', onPlaying);
    v.addEventListener('error', onError);
    v.addEventListener('loadedmetadata', onMeta);
    return () => {
      v.removeEventListener('playing', onPlaying);
      v.removeEventListener('error', onError);
      v.removeEventListener('loadedmetadata', onMeta);
    };
  }, [ref, fallo]);

  return { intento, fallo, vaAReintentar };
}
