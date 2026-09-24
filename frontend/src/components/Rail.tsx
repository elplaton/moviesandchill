import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { IconChevronL, IconChevronR } from './ui/Icon';

interface Props {
  title: string;
  children: ReactNode;
  /** Enlace opcional a la derecha del título ("Ver todo"). */
  action?: ReactNode;
}

/**
 * Carril horizontal con flechas.
 *
 * En una tele se mueve el foco y en un móvil se desliza con el dedo, pero en
 * un escritorio no hay ninguna de las dos cosas: sin flechas, la mitad del
 * carril es invisible salvo que el ratón tenga rueda horizontal. Aparecen al
 * pasar por encima y solo cuando hay a dónde ir, y avanzan una pantalla justa.
 */
export default function Rail({ title, children, action }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ left: el.scrollLeft > 8, right: el.scrollLeft < max - 8 });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, children]);

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
