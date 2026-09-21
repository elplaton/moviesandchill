import { useCallback, useRef, type ReactNode } from 'react';
import { getElement } from '../focus/engine';
import { FocusScope } from '../focus/react';

interface MovieRowProps {
  title: string;
  children: ReactNode;
  /** Posicion de la fila dentro de la pantalla (para el orden de navegacion). */
  index?: number;
  id?: string;
}

/** Margen que se deja a la izquierda del elemento enfocado. */
const EDGE_PADDING = 56;

/**
 * Carril horizontal de tarjetas.
 *
 * El desplazamiento se hace con `transform: translate3d` sobre la pista, no
 * con scrollLeft ni scrollIntoView: es una propiedad de compositor, no pasa
 * por layout y la TV la resuelve sin repintar las tarjetas.
 *
 * Al enfocar se leen `offsetLeft` y `offsetWidth` de UN solo hijo. El motor
 * anterior medía los ~260 elementos de la pantalla en cada pulsacion.
 */
export default function MovieRow({ title, children, index, id }: MovieRowProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);

  const handleChildFocus = useCallback((_childIndex: number, childId: string) => {
    const track = trackRef.current;
    const viewport = viewportRef.current;
    if (!track || !viewport) return;

    const child = getElement(childId);
    if (!child) return;

    const itemLeft = child.offsetLeft;
    const itemRight = itemLeft + child.offsetWidth;
    const viewWidth = viewport.clientWidth;
    let next = offsetRef.current;

    if (itemLeft - next < EDGE_PADDING) {
      next = Math.max(0, itemLeft - EDGE_PADDING);
    } else if (itemRight - next > viewWidth - EDGE_PADDING) {
      next = itemRight - viewWidth + EDGE_PADDING;
    }

    const maxOffset = Math.max(0, track.scrollWidth - viewWidth);
    next = Math.min(Math.max(0, next), maxOffset);

    if (next !== offsetRef.current) {
      offsetRef.current = next;
      track.style.transform = `translate3d(${-next}px, 0, 0)`;
    }
  }, []);

  return (
    <FocusScope
      id={id}
      index={index}
      orientation="horizontal"
      onChildFocus={handleChildFocus}
      className="relative mb-10"
    >
      <h2 className="text-white text-lg md:text-xl font-medium mb-5 px-6 md:px-14">{title}</h2>
      {/*
        La altura minima mantiene el hueco aunque la fila aun no haya montado
        sus tarjetas, para que el layout no salte al virtualizar.

        El relleno vertical no es decorativo: la tarjeta enfocada escala a 1.1
        y sube 4 px, y como el carril recorta con overflow-hidden, sin ese
        hueco la caratula se comia el titulo de la seccion y aparecia cortada.
      */}
      <div ref={viewportRef} className="relative overflow-hidden min-h-[21.5rem]">
        <div
          ref={trackRef}
          className="rail-track flex gap-2 px-6 md:px-14 pt-8 pb-5"
          style={{ transform: 'translate3d(0, 0, 0)' }}
        >
          {children}
        </div>
      </div>
    </FocusScope>
  );
}
