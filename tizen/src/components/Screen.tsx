import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getElement, setFocus } from '../focus/engine';
import { FocusScope, useBackHandler } from '../focus/react';
import { takeContentFocus } from '../tv/intent';
import { setFeatured } from '../tv/featured';
import Hero from './Hero';
import type { Featured } from '../types';

interface Props {
  children: ReactNode;
  /** Panel de informacion arriba (portadas). Sin el, el contenido empieza arriba. */
  hero?: boolean;
  heroFallback?: Featured | null;
  heading?: string;
  /** Se pone a true cuando la pagina ya tiene tarjetas montadas. */
  ready?: boolean;
  /** Id del contenedor cuyo primer elemento recibe el foco al llegar desde el rail. */
  firstFocusId?: string;
  /** Indice de la fila que acaba de recibir el foco (para montar solo las cercanas). */
  onRowFocus?: (index: number) => void;
  /** Desplaza la columna para alinear la fila enfocada (carriles). Desactivado en pantallas fijas. */
  scroll?: boolean;
}

/** Al llegar desde el rail con OK, el foco entra en el contenido en cuanto hay algo. */
export function useContentFocus(ready: boolean | undefined, firstFocusId?: string) {
  useEffect(() => {
    if (!ready) return;
    if (!takeContentFocus()) return;
    const raf = requestAnimationFrame(() => setFocus(firstFocusId || 'content'));
    return () => cancelAnimationFrame(raf);
  }, [ready, firstFocusId]);
}

/** Atras en cualquier pantalla que no sea Inicio vuelve a Inicio. */
export function useScreenBack() {
  const navigate = useNavigate();
  const location = useLocation();
  const isHome = location.pathname === '/';
  useBackHandler(() => {
    if (isHome) return false; // sin manejador: la tecla llega al motor y cierra la app
    navigate('/');
    return true;
  }, true);
}

const HERO = 470;
const TOP_NO_HERO = 100;

/**
 * Armazon de una pantalla: columna de contenido a la derecha del rail, con
 * desplazamiento vertical por transform. La fila enfocada se coloca justo
 * debajo del panel de informacion; las de arriba se ocultan tras el.
 *
 * Atras en cualquier pantalla que no sea Inicio vuelve a Inicio.
 */
export default function Screen({ children, hero, heroFallback, heading, ready, firstFocusId, onRowFocus, scroll = true }: Props) {
  const contentRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  useScreenBack();
  useContentFocus(ready, firstFocusId);
  // El destacado es global: al cambiar de pantalla se vacia para que no se
  // enseñe el de la pantalla anterior hasta que una tarjeta tome el foco.
  useEffect(() => { setFeatured(null); }, []);

  const top = hero ? HERO : TOP_NO_HERO;

  const onChildFocus = useCallback((i: number, childId: string) => {
    onRowFocus?.(i);
    if (!scroll) return;
    const wrap = contentRef.current;
    const el = getElement(childId);
    if (!wrap || !el) return;
    // offsetTop es relativo a la columna, que ya empieza bajo el panel.
    const next = Math.max(0, el.offsetTop);
    if (next !== offsetRef.current) {
      offsetRef.current = next;
      wrap.style.transform = `translate3d(0, ${-next}px, 0)`;
    }
  }, [top, onRowFocus, scroll]);

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ paddingLeft: 0 }}>
      {hero && <Hero fallback={heroFallback} heading={heading} />}
      {!hero && heading && (
        <h1 className="absolute top-[52px] text-h1 font-bold z-20" style={{ left: 'var(--content-x)' }}>{heading}</h1>
      )}
      <FocusScope id="content" index={1} orientation="vertical" onChildFocus={onChildFocus} as="none">
        <div ref={contentRef} className="tv-content absolute left-0 right-0 z-10" style={{ top, transform: 'translate3d(0,0,0)' }}>
          {children}
        </div>
      </FocusScope>
      {/* mascara bajo el rail: las tarjetas que salen por la izquierda se funden */}
      <div className="absolute left-0 top-0 bottom-0 z-30 pointer-events-none" style={{ width: 'var(--content-x)', background: 'linear-gradient(90deg, #141414 0%, #141414 54%, rgba(20,20,20,0) 100%)' }} />
      {/* velo inferior para que el ultimo carril no corte en seco */}
      <div className="absolute left-0 right-0 bottom-0 h-[60px] z-20 pointer-events-none" style={{ background: 'linear-gradient(180deg, rgba(20,20,20,0), #141414)' }} />
    </div>
  );
}
