import { useCallback, useRef, type ReactNode } from 'react';
import { getElement } from '../focus/engine';
import { FocusScope } from '../focus/react';

interface Props {
  title: string;
  children: ReactNode;
  index?: number;
  id?: string;
  /** Alto reservado para que el layout no salte mientras la fila esta vacia. */
  minHeight?: number;
  /** Margen izquierdo; por defecto el del contenido. */
  inset?: number | string;
}

const EDGE = 0; // la tarjeta enfocada se alinea con el borde izquierdo del contenido

/**
 * Carril horizontal. Se desplaza con translate3d sobre la pista (compositor
 * puro) y al enfocar se mide UN solo hijo. La tarjeta enfocada se queda pegada
 * al margen izquierdo, como en cualquier interfaz de television: asi siempre
 * hay carril por delante y se sabe por donde se va.
 */
export default function Row({ title, children, index, id, minHeight, inset }: Props) {
  const left = inset ?? 'var(--content-x)';
  const trackRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);

  const onChildFocus = useCallback((_i: number, childId: string) => {
    const track = trackRef.current;
    const child = getElement(childId);
    if (!track || !child) return;
    const next = Math.max(0, child.offsetLeft - EDGE);
    if (next !== offsetRef.current) {
      offsetRef.current = next;
      track.style.transform = `translate3d(${-next}px, 0, 0)`;
    }
  }, []);

  return (
    <FocusScope id={id} index={index} orientation="horizontal" onChildFocus={onChildFocus} className="relative mb-9">
      <h2 className="text-row font-semibold text-tv-text mb-3" style={{ paddingLeft: left }}>{title}</h2>
      {/* pt/pb dejan sitio a la escala de la tarjeta enfocada (sube ~17 px) sin recortarla ni pisar el titulo */}
      <div className="relative overflow-hidden" style={{ minHeight: minHeight ?? 340, paddingLeft: left }}>
        <div ref={trackRef} className="rail-track flex gap-[18px] pt-[30px] pb-6" style={{ transform: 'translate3d(0,0,0)' }}>
          {children}
        </div>
      </div>
    </FocusScope>
  );
}
