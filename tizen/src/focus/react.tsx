/**
 * Enganche de React con el motor de foco.
 *
 * Regla de oro: enfocar NO re-renderiza. useFocusItem devuelve una ref y nada
 * mas; el estado de foco viaja como una clase en el nodo del DOM. Solo los
 * componentes que de verdad necesitan reaccionar usan useIsFocused(), que si
 * se suscribe.
 */
import {
  createContext, useContext, useEffect, useId, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import {
  applyFocus, debugTree, getCurrentFocusId, popRoot, pushRoot, registerContainer,
  registerItem, setFocus, subscribe, unregister,
  type Orientation,
} from './engine';
import { installKeyHandling, pushBackHandler } from './keys';

const ScopeContext = createContext<string | null>(null);

export function useFocusScopeId(): string | null {
  return useContext(ScopeContext);
}

// ------------------------------------------------------------------ scope

interface FocusScopeProps {
  children: ReactNode;
  orientation?: Orientation;
  /** Columnas cuando orientation="grid". */
  columns?: number;
  /** Id estable. Si se omite se genera uno. */
  id?: string;
  /** Posicion entre hermanos. Necesario en listas virtualizadas. */
  index?: number;
  /** Avisa cuando el foco entra en uno de sus hijos: lo usa la fila para desplazarse. */
  onChildFocus?: (childIndex: number, childId: string) => void;
  /** Atrapa el foco dentro (modales, pantallas). */
  trap?: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** Si es false no envuelve en un div (util dentro de layouts flex). */
  as?: 'div' | 'none';
}

export function FocusScope({
  children, orientation = 'vertical', columns, id, index, onChildFocus,
  trap, className, style, as = 'div',
}: FocusScopeProps) {
  const autoId = useId();
  const scopeId = id || `scope${autoId}`;
  const parentId = useContext(ScopeContext);
  const elRef = useRef<HTMLDivElement>(null);

  // La callback se guarda en una ref para que el motor siempre llame a la
  // ultima version sin tener que re-registrar el contenedor en cada render.
  const childFocusRef = useRef(onChildFocus);
  childFocusRef.current = onChildFocus;

  useEffect(() => {
    registerContainer({
      id: scopeId,
      parentId: trap ? null : parentId,
      index,
      orientation,
      columns,
      el: elRef.current,
      onChildFocus: (i, cid) => childFocusRef.current?.(i, cid),
    });
    if (trap) pushRoot(scopeId);
    return () => {
      if (trap) popRoot(scopeId);
      unregister(scopeId);
    };
  }, [scopeId, parentId, index, orientation, columns, trap]);

  const content = (
    <ScopeContext.Provider value={scopeId}>{children}</ScopeContext.Provider>
  );

  if (as === 'none') return content;
  return (
    <div ref={elRef} className={className} style={style}>
      {content}
    </div>
  );
}

// ------------------------------------------------------------------- item

interface UseFocusItemOptions {
  focusKey?: string;
  index?: number;
  onEnter?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  disabled?: boolean;
  /** Toma el foco al montarse si no hay nada enfocado todavia. */
  autoFocus?: boolean;
}

export function useFocusItem<T extends HTMLElement = HTMLDivElement>(
  options: UseFocusItemOptions = {},
) {
  const { focusKey, index, disabled, autoFocus } = options;
  const autoId = useId();
  const id = focusKey || `item${autoId}`;
  const parentId = useContext(ScopeContext);
  const ref = useRef<T>(null);

  // Los callbacks van por ref: cambiar onEnter no debe re-registrar el nodo.
  const handlers = useRef(options);
  handlers.current = options;

  useEffect(() => {
    registerItem({
      id,
      parentId,
      index,
      el: ref.current,
      disabled,
      onEnter: () => handlers.current.onEnter?.(),
      onFocus: () => handlers.current.onFocus?.(),
      onBlur: () => handlers.current.onBlur?.(),
    });
    if (autoFocus && !getCurrentFocusId()) applyFocus(id);
    return () => unregister(id);
  }, [id, parentId, index, disabled, autoFocus]);

  return { ref, focusKey: id };
}

/**
 * Suscripcion al estado de foco. Provoca re-render, asi que se usa solo donde
 * hace falta de verdad (por ejemplo un input que abre el teclado). Las
 * tarjetas NO deben usar esto: su estado visual va por CSS.
 */
export function useIsFocused(id: string): boolean {
  const [focused, setFocused] = useState(() => getCurrentFocusId() === id);
  useEffect(() => {
    setFocused(getCurrentFocusId() === id);
    return subscribe((current) => setFocused(current === id));
  }, [id]);
  return focused;
}

// ------------------------------------------------------------------- root

export function FocusRoot({ children }: { children: ReactNode }) {
  useEffect(() => {
    installKeyHandling();
    // Se expone para poder inspeccionarlo desde el inspector de la TV:
    //   ./tools/tv-debug.py --eval "__focus().arbol"
    (window as unknown as { __focus?: unknown }).__focus = debugTree;
  }, []);
  return (
    <FocusScope id="app-root" orientation="vertical" trap as="none">
      {children}
    </FocusScope>
  );
}

/** Registra un handler para la tecla Atras mientras el componente este montado. */
export function useBackHandler(handler: () => boolean | void, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    return pushBackHandler(() => ref.current());
  }, [enabled]);
}

/** Enfoca un id concreto cuando `when` pasa a true. Sustituye a los setTimeout encadenados. */
export function useFocusOn(id: string | null, when: boolean) {
  useEffect(() => {
    if (!when || !id) return;
    // Un frame de margen para que los hijos se hayan registrado.
    const raf = requestAnimationFrame(() => setFocus(id));
    return () => cancelAnimationFrame(raf);
  }, [id, when]);
}

export const focusById = setFocus;
export { useMemo };
