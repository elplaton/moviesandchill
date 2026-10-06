import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  /** Se pide mas al acercarse al final del carril (o al principio). */
  onNearEnd?: () => void;
  onNearStart?: () => void;
  /**
   * Cuantas caratulas se han soltado por la izquierda. Al quitarlas todo se
   * desplaza; con esto el carril corrige su scroll y lo que se esta mirando
   * no se mueve.
   */
  shift?: number;
  /** Donde estaba el carril al salir de la pantalla, y donde anotarlo. */
  scrollX?: number;
  onScrollX?: (x: number) => void;
}

/** Paso de una caratula (ancho + hueco), medido de las dos primeras. */
function paso(el: HTMLElement): number {
  const a = el.children[0] as HTMLElement | undefined;
  const b = el.children[1] as HTMLElement | undefined;
  if (a && b) return b.offsetLeft - a.offsetLeft;
  return a ? a.getBoundingClientRect().width : 0;
}

export default function Row({ title, children, action, onNearEnd, onNearStart,
                              shift, scrollX, onScrollX }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Por referencia y no en las dependencias: el padre los recrea en cada
  // render y si no se volveria a enganchar el observador en cada pagina.
  const avisos = useRef({ onNearEnd, onNearStart, onScrollX });
  avisos.current = { onNearEnd, onNearStart, onScrollX };

  const medir = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const { onNearEnd: alFinal, onNearStart: alPrincipio, onScrollX: anotar } = avisos.current;
    anotar?.(el.scrollLeft);
    // Una pantalla de margen: la pagina siguiente llega antes de que se vea
    // el final, asi que el dedo nunca se queda contra un hueco vacio.
    const margen = el.clientWidth;
    if (alFinal && el.scrollLeft > max - margen) alFinal();
    if (alPrincipio && el.scrollLeft < margen) alPrincipio();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [medir, children]);

  const restaurado = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || restaurado.current || !scrollX) return;
    restaurado.current = true;
    el.scrollLeft = scrollX;
  }, [scrollX]);

  const ultimoShift = useRef(shift ?? 0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || shift === undefined) return;
    const d = shift - ultimoShift.current;
    if (d === 0) return;
    ultimoShift.current = shift;
    el.scrollLeft -= d * paso(el);
  }, [shift]);

  return (
    <section className="mb-6">
      <div className="flex items-baseline justify-between px-4 mb-2">
        <h2 className="text-[17px] font-semibold">{title}</h2>
        {action}
      </div>
      <div ref={ref} onScroll={medir}
        className="flex gap-3 overflow-x-auto no-scrollbar px-4 snap-row">{children}</div>
    </section>
  );
}
