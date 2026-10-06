import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { IconChevronL, IconChevronR } from './ui/Icon';

interface Props {
  title: string;
  children: ReactNode;
  /** Enlace opcional a la derecha del título ("Ver todo"). */
  action?: ReactNode;
  /** Se pide más cuando quedan menos de una pantalla por delante (o por detrás). */
  onNearEnd?: () => void;
  onNearStart?: () => void;
  /**
   * Cuántas tarjetas se ha movido el contenido por la izquierda. Al soltar las
   * antiguas, todo lo demás se desplaza; con esto el carril corrige su scroll y
   * lo que se está mirando no se mueve ni un píxel.
   */
  shift?: number;
  /** Posición horizontal con la que abrir, y dónde anotarla al moverse. */
  scrollX?: number;
  onScrollX?: (x: number) => void;
}

/** Mueve el scroll sin animación: `.rail` lleva `scroll-behavior: smooth` en
 *  el CSS, y una corrección animada se ve como un salto del carril. */
function sinAnimacion(el: HTMLElement, fn: () => void) {
  const antes = el.style.scrollBehavior;
  el.style.scrollBehavior = 'auto';
  fn();
  el.style.scrollBehavior = antes;
}

/** Paso de una tarjeta (ancho + hueco), medido de las dos primeras. */
function paso(el: HTMLElement): number {
  const a = el.children[0] as HTMLElement | undefined;
  const b = el.children[1] as HTMLElement | undefined;
  if (a && b) return b.offsetLeft - a.offsetLeft;
  return a ? a.getBoundingClientRect().width : 0;
}

/**
 * Carril horizontal con flechas.
 *
 * En una tele se mueve el foco y en un móvil se desliza con el dedo, pero en
 * un escritorio no hay ninguna de las dos cosas: sin flechas, la mitad del
 * carril es invisible salvo que el ratón tenga rueda horizontal. Aparecen al
 * pasar por encima y solo cuando hay a dónde ir, y avanzan una pantalla justa.
 */
export default function Rail({ title, children, action, onNearEnd, onNearStart,
                               shift, scrollX, onScrollX }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  // Los avisos van por referencia y no en las dependencias: el padre los
  // recrea en cada render y si no `measure` cambiaría de identidad, lo que
  // volvería a montar el ResizeObserver cada vez que llega una página.
  const avisos = useRef({ onNearEnd, onNearStart, onScrollX });
  avisos.current = { onNearEnd, onNearStart, onScrollX };

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ left: el.scrollLeft > 8, right: el.scrollLeft < max - 8 });
    const { onNearEnd: alFinal, onNearStart: alPrincipio, onScrollX: anotar } = avisos.current;
    anotar?.(el.scrollLeft);
    // Una pantalla de margen: la página siguiente llega antes de que se vea el
    // final, así que el carril nunca se queda cortado esperando a la red.
    const margen = el.clientWidth;
    if (alFinal && el.scrollLeft > max - margen) alFinal();
    if (alPrincipio && el.scrollLeft < margen) alPrincipio();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, children]);

  // Al volver a la página, el carril se abre donde se dejó.
  const restaurado = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || restaurado.current || !scrollX) return;
    restaurado.current = true;
    sinAnimacion(el, () => { el.scrollLeft = scrollX; });
  }, [scrollX]);

  // Corrección por las tarjetas que se han soltado por la izquierda.
  const ultimoShift = useRef(shift ?? 0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || shift === undefined) return;
    const d = shift - ultimoShift.current;
    if (d === 0) return;
    ultimoShift.current = shift;
    sinAnimacion(el, () => { el.scrollLeft -= d * paso(el); });
  }, [shift]);

  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * (el.clientWidth - 120), behavior: 'smooth' });
  };

  const arrow = 'rail-arrow absolute top-0 bottom-0 z-40 grid w-[56px] place-items-center bg-nf-bg/80 text-white hover:bg-nf-bg/95 disabled:hidden';

  return (
    <section className="rail-wrap relative mb-10">
      <div className="mb-3 flex items-baseline justify-between px-gutter">
        <h2 className="text-lg font-semibold">{title}</h2>
        {action}
      </div>

      <div className="relative">
        <button onClick={() => page(-1)} disabled={!edges.left} aria-label="Anterior"
          className={`${arrow} left-0`} style={{ opacity: edges.left ? undefined : 0 }}>
          <span className="w-7 h-7"><IconChevronL /></span>
        </button>

        {/* El padding vertical reserva el sitio que ocupa la tarjeta al crecer:
            el carril recorta en horizontal, así que sin él se vería cortada. */}
        <div ref={ref} onScroll={measure}
          className="rail no-scrollbar flex gap-[var(--row-gap)] px-gutter py-3">
          {children}
        </div>

        <button onClick={() => page(1)} disabled={!edges.right} aria-label="Siguiente"
          className={`${arrow} right-0`} style={{ opacity: edges.right ? undefined : 0 }}>
          <span className="w-7 h-7"><IconChevronR /></span>
        </button>
      </div>
    </section>
  );
}
