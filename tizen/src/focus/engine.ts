/**
 * Motor de foco para TV.
 *
 * Sustituye a la navegacion espacial geometrica (Norigin). La diferencia de
 * fondo: aqui la app declara su propia estructura (filas, rejillas, columnas)
 * y moverse es aritmetica de indices, no medir el DOM.
 *
 * Norigin llamaba a getBoundingClientRect() sobre TODOS los hermanos en cada
 * pulsacion (LAYOUT_STALE_TIME = 16 ms), y como esta app no usaba contenedores
 * de foco, las ~260 tarjetas del Home eran hermanas entre si: 260 reflows
 * sincronos por flecha. Aqui mover el foco es O(1) y no toca el layout.
 *
 * Ademas el foco NO pasa por el estado de React: se aplica una clase al nodo
 * del DOM. Mover el foco re-renderiza cero componentes.
 */

export type Orientation = 'horizontal' | 'vertical' | 'grid';
export type Direction = 'left' | 'right' | 'up' | 'down';

export const FOCUS_CLASS = 'is-focused';

interface BaseNode {
  id: string;
  parentId: string | null;
  index: number;
}

export interface ContainerNode extends BaseNode {
  kind: 'container';
  orientation: Orientation;
  columns: number;
  childIds: string[];
  lastChildId: string | null;
  el: HTMLElement | null;
  /** Se llama al enfocar algo dentro: la fila lo usa para desplazar su carril. */
  onChildFocus?: (childIndex: number, childId: string) => void;
}

export interface ItemNode extends BaseNode {
  kind: 'item';
  el: HTMLElement | null;
  onEnter?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  disabled: boolean;
}

export type FocusNode = ContainerNode | ItemNode;

const nodes = new Map<string, FocusNode>();
/** Pila de raices activas: cada modal o pantalla apila la suya y atrapa el foco. */
const rootStack: string[] = [];
/** currentId guardado al apilar una raiz, para restaurarlo al cerrarla. */
const savedFocus: (string | null)[] = [];

let currentId: string | null = null;
/**
 * Elemento que lleva puesta la clase de foco ahora mismo.
 *
 * Se guarda la referencia directa en vez de buscarla por id: si el nodo se
 * desregistra o se vuelve a registrar entre dos movimientos, buscarlo por id
 * podia fallar y la clase se quedaba pegada, con lo que se veian dos focos
 * a la vez en pantalla.
 */
let focusedEl: HTMLElement | null = null;
let paused = false;

type Listener = (id: string | null) => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getCurrentFocusId(): string | null {
  return currentId;
}

export function isFocused(id: string): boolean {
  return currentId === id;
}

// ---------------------------------------------------------------- registro

/**
 * Orden de hermanos: por `index` explicito y, si empatan, por posicion real en
 * el DOM. Asi las listas virtualizadas (que pasan index) y los formularios
 * estaticos (que no lo pasan) funcionan igual. Solo se ejecuta al registrar,
 * nunca al navegar.
 */
function sortChildren(parent: ContainerNode) {
  parent.childIds.sort((a, b) => {
    const na = nodes.get(a);
    const nb = nodes.get(b);
    const byIndex = (na ? na.index : 0) - (nb ? nb.index : 0);
    if (byIndex !== 0) return byIndex;
    const ea = na ? na.el : null;
    const eb = nb ? nb.el : null;
    if (ea && eb && ea !== eb) {
      const pos = ea.compareDocumentPosition(eb);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    }
    return 0;
  });
}

function linkToParent(node: FocusNode) {
  if (!node.parentId) return;
  const parent = nodes.get(node.parentId);
  if (!parent || parent.kind !== 'container') return;
  if (!parent.childIds.includes(node.id)) parent.childIds.push(node.id);
  sortChildren(parent);
}

/**
 * Recoge los nodos que ya se habian registrado declarando a este contenedor
 * como padre cuando el contenedor todavia no existia.
 *
 * Hace falta porque React ejecuta los efectos de hijo a padre: la tarjeta
 * llama a registerItem() con el id de su fila antes de que la fila haya
 * llamado a registerContainer(). Sin esto las filas se quedaban con la lista
 * de hijos vacia y no se podia navegar en horizontal.
 */
function adoptOrphans(container: ContainerNode) {
  let found = false;
  nodes.forEach((node) => {
    if (node.parentId === container.id && !container.childIds.includes(node.id)) {
      container.childIds.push(node.id);
      found = true;
    }
  });
  if (found) sortChildren(container);
}

function attach(node: FocusNode) {
  nodes.set(node.id, node);
  linkToParent(node);
  if (node.kind === 'container') adoptOrphans(node);
}

export function registerContainer(init: {
  id: string;
  parentId: string | null;
  index?: number;
  orientation: Orientation;
  columns?: number;
  el?: HTMLElement | null;
  onChildFocus?: ContainerNode['onChildFocus'];
}): void {
  const existing = nodes.get(init.id);
  if (existing && existing.kind === 'container') {
    existing.parentId = init.parentId;
    existing.index = init.index ?? 0;
    existing.orientation = init.orientation;
    existing.columns = init.columns ?? 1;
    existing.el = init.el ?? existing.el;
    existing.onChildFocus = init.onChildFocus;
    if (init.parentId) attach(existing);
    return;
  }
  attach({
    kind: 'container',
    id: init.id,
    parentId: init.parentId,
    index: init.index ?? 0,
    orientation: init.orientation,
    columns: init.columns ?? 1,
    childIds: [],
    lastChildId: null,
    el: init.el ?? null,
    onChildFocus: init.onChildFocus,
  });
}

export function registerItem(init: {
  id: string;
  parentId: string | null;
  index?: number;
  el?: HTMLElement | null;
  onEnter?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  disabled?: boolean;
}): void {
  const existing = nodes.get(init.id);
  if (existing && existing.kind === 'item') {
    if (
      existing.parentId &&
      init.parentId &&
      existing.parentId !== init.parentId &&
      existing.el &&
      init.el &&
      existing.el !== init.el
    ) {
      // Dos elementos distintos vivos compartiendo focusKey. El segundo roba
      // el nodo y el primero queda huerfano: navegar desde el salta a otra
      // parte de la pantalla. Paso exactamente esto en la portada, donde
      // /browse/home devuelve la misma pelicula en varias filas de genero.
      console.warn(
        `[focus] focusKey duplicado: "${init.id}". Cada elemento enfocable ` +
        'necesita una clave unica en la pantalla, o la navegacion salta.',
      );
    }
    existing.parentId = init.parentId;
    existing.index = init.index ?? 0;
    existing.el = init.el ?? existing.el;
    existing.onEnter = init.onEnter;
    existing.onFocus = init.onFocus;
    existing.onBlur = init.onBlur;
    existing.disabled = init.disabled ?? false;
    if (init.parentId) attach(existing);
    if (currentId === init.id && existing.el) {
      if (focusedEl && focusedEl !== existing.el) focusedEl.classList.remove(FOCUS_CLASS);
      existing.el.classList.add(FOCUS_CLASS);
      focusedEl = existing.el;
    }
    return;
  }
  attach({
    kind: 'item',
    id: init.id,
    parentId: init.parentId,
    index: init.index ?? 0,
    el: init.el ?? null,
    onEnter: init.onEnter,
    onFocus: init.onFocus,
    onBlur: init.onBlur,
    disabled: init.disabled ?? false,
  });
  if (currentId === init.id) {
    const n = nodes.get(init.id) as ItemNode;
    if (n.el) {
      if (focusedEl && focusedEl !== n.el) focusedEl.classList.remove(FOCUS_CLASS);
      n.el.classList.add(FOCUS_CLASS);
      focusedEl = n.el;
    }
  }
}

export function unregister(id: string): void {
  const node = nodes.get(id);
  if (!node) return;
  if (node.parentId) {
    const parent = nodes.get(node.parentId);
    if (parent && parent.kind === 'container') {
      parent.childIds = parent.childIds.filter((c) => c !== id);
      if (parent.lastChildId === id) parent.lastChildId = null;
    }
  }
  if (node.kind === 'item' && node.el && node.el === focusedEl) {
    focusedEl.classList.remove(FOCUS_CLASS);
    focusedEl = null;
  }
  nodes.delete(id);
  if (currentId === id) {
    currentId = null;
    scheduleRecovery();
  }
}

let recoveryScheduled = false;

/**
 * Recoloca el foco cuando el elemento enfocado desaparece.
 *
 * Va diferido a proposito: al cambiar de pantalla React desmonta el arbol
 * viejo antes de montar el nuevo, y recolocar en ese instante dejaba el foco
 * en la barra superior o en ninguna parte. Un frame despues la pantalla nueva
 * ya se ha registrado.
 */
function scheduleRecovery() {
  if (recoveryScheduled) return;
  recoveryScheduled = true;
  const run = () => {
    recoveryScheduled = false;
    if (currentId && nodes.has(currentId)) return;
    const root = activeRoot();
    const fallback = root ? descend(root) : null;
    if (fallback) applyFocus(fallback);
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 0);
}

// ------------------------------------------------------------------ raices

function activeRoot(): string | null {
  for (let i = rootStack.length - 1; i >= 0; i--) {
    if (nodes.has(rootStack[i])) return rootStack[i];
  }
  return null;
}

/** ¿Este nodo cuelga de esa raiz? */
function isInside(id: string, rootId: string): boolean {
  let node: FocusNode | undefined = nodes.get(id);
  while (node) {
    if (node.id === rootId) return true;
    if (!node.parentId) return false;
    node = nodes.get(node.parentId);
  }
  return false;
}

export function pushRoot(id: string): void {
  savedFocus.push(currentId);
  rootStack.push(id);
  // El foco tiene que entrar en el modal. Si se queda fuera, las flechas no
  // hacen nada: el elemento enfocado ya no pertenece a la raiz activa, asi que
  // la navegacion no encuentra por donde moverse. Antes cada modal tenia que
  // acordarse de llamar a setFocus, y el teclado en pantalla no lo hacia.
  const first = descend(id);
  if (first) applyFocus(first);
}

export function popRoot(id: string): void {
  const idx = rootStack.lastIndexOf(id);
  if (idx === -1) return;
  rootStack.splice(idx, 1);
  const restore = savedFocus.splice(idx, 1)[0] ?? null;
  if (restore && nodes.has(restore)) {
    applyFocus(restore);
  } else {
    const root = activeRoot();
    const next = root ? descend(root) : null;
    if (next) applyFocus(next);
  }
}

// -------------------------------------------------------------- navegacion

function isItem(node: FocusNode | undefined): node is ItemNode {
  return !!node && node.kind === 'item';
}

/**
 * Baja por el arbol hasta una hoja enfocable.
 *
 * Orden de preferencia al entrar en un contenedor:
 *   1. la memoria de fila (donde se dejo el foco la ultima vez),
 *   2. `preferred`, la columna en la que se venia,
 *   3. el primer hijo.
 *
 * El paso 2 es lo que hace que bajar de fila caiga debajo de donde estabas y
 * no al principio de la fila.
 */
function descend(id: string, preferred?: number): string | null {
  const node = nodes.get(id);
  if (!node) return null;
  if (isItem(node)) return node.disabled ? null : node.id;

  if (node.lastChildId && nodes.has(node.lastChildId)) {
    const viaMemory = descend(node.lastChildId, preferred);
    if (viaMemory) return viaMemory;
  }

  if (preferred !== undefined && node.childIds.length > 0) {
    const clamped = Math.min(Math.max(preferred, 0), node.childIds.length - 1);
    const viaColumn = descend(node.childIds[clamped], preferred);
    if (viaColumn) return viaColumn;
    // Si esa columna no vale, se busca hacia fuera desde ella.
    for (let d = 1; d < node.childIds.length; d++) {
      for (const idx of [clamped - d, clamped + d]) {
        if (idx < 0 || idx >= node.childIds.length) continue;
        const found = descend(node.childIds[idx], preferred);
        if (found) return found;
      }
    }
    return null;
  }

  for (const childId of node.childIds) {
    const found = descend(childId, preferred);
    if (found) return found;
  }
  return null;
}

function axisOf(dir: Direction): 'h' | 'v' {
  return dir === 'left' || dir === 'right' ? 'h' : 'v';
}

function stepOf(dir: Direction): number {
  return dir === 'right' || dir === 'down' ? 1 : -1;
}

/** Primer hermano en esa direccion que contenga algo enfocable. */
function neighbour(
  parent: ContainerNode, fromIndex: number, step: number, preferred?: number,
): string | null {
  const order = parent.childIds;
  for (let i = fromIndex + step; i >= 0 && i < order.length; i += step) {
    const candidate = descend(order[i], preferred);
    if (candidate) return candidate;
  }
  return null;
}

function gridNeighbour(parent: ContainerNode, fromIndex: number, dir: Direction): string | null {
  const cols = Math.max(1, parent.columns);
  const order = parent.childIds;
  const row = Math.floor(fromIndex / cols);
  const col = fromIndex % cols;

  if (dir === 'left' || dir === 'right') {
    const step = stepOf(dir);
    for (let c = col + step; c >= 0 && c < cols; c += step) {
      const idx = row * cols + c;
      if (idx >= order.length) break;
      const candidate = descend(order[idx]);
      if (candidate) return candidate;
    }
    return null;
  }

  const step = stepOf(dir);
  for (let r = row + step; r >= 0; r += step) {
    const idx = r * cols + col;
    if (idx >= order.length) {
      if (step > 0) break;
      continue;
    }
    const candidate = descend(order[idx]);
    if (candidate) return candidate;
    // Si esa celda exacta no vale, se prueba el resto de la fila.
    for (let c = cols - 1; c >= 0; c--) {
      const alt = r * cols + c;
      if (alt >= order.length) continue;
      const found = descend(order[alt]);
      if (found) return found;
    }
  }
  return null;
}

export function move(dir: Direction): boolean {
  if (paused) return false;

  const root = activeRoot();

  // Sin foco valido, o con el foco fuera de la raiz activa, el mando quedaria
  // muerto. Se entra en la raiz y se consume la pulsacion.
  if (!currentId || !nodes.has(currentId) || (root && !isInside(currentId, root))) {
    const first = root ? descend(root) : null;
    if (first) {
      applyFocus(first);
      return true;
    }
    return false;
  }

  let node = nodes.get(currentId);
  if (!node) return false;

  const axis = axisOf(dir);

  // Columna de partida: se arrastra hacia abajo para que al entrar en una fila
  // nueva el foco caiga en la misma posicion en la que se venia.
  let preferred: number | undefined;
  if (node.parentId) {
    const ownParent = nodes.get(node.parentId);
    if (ownParent && ownParent.kind === 'container') {
      const i = ownParent.childIds.indexOf(node.id);
      if (i !== -1) preferred = i;
    }
  }

  while (node && node.parentId && node.id !== root) {
    const parent = nodes.get(node.parentId);
    if (!parent || parent.kind !== 'container') break;

    let next: string | null = null;
    if (parent.orientation === 'grid') {
      const idx = parent.childIds.indexOf(node.id);
      if (idx !== -1) next = gridNeighbour(parent, idx, dir);
    } else {
      const parentAxis = parent.orientation === 'horizontal' ? 'h' : 'v';
      if (parentAxis === axis) {
        const idx = parent.childIds.indexOf(node.id);
        if (idx !== -1) next = neighbour(parent, idx, stepOf(dir), preferred);
      }
    }

    if (next) {
      applyFocus(next);
      return true;
    }
    if (parent.id === root) break;
    node = parent;
  }
  return false;
}

export function enter(): boolean {
  if (paused || !currentId) return false;
  const node = nodes.get(currentId);
  if (isItem(node) && !node.disabled && node.onEnter) {
    node.onEnter();
    return true;
  }
  return false;
}

// ------------------------------------------------------------ aplicar foco

function markPath(id: string) {
  // Cada contenedor recuerda por donde se entro y avisa para que la fila
  // desplace su carril. Es una cadena corta (fila -> pantalla), no un barrido.
  let child = nodes.get(id);
  while (child && child.parentId) {
    const parent = nodes.get(child.parentId);
    if (!parent || parent.kind !== 'container') break;
    parent.lastChildId = child.id;
    if (parent.onChildFocus) {
      const idx = parent.childIds.indexOf(child.id);
      parent.onChildFocus(idx, child.id);
    }
    child = parent;
  }
}

export function applyFocus(id: string): void {
  if (currentId === id) {
    markPath(id);
    return;
  }
  const prev = currentId ? nodes.get(currentId) : undefined;
  if (focusedEl) {
    focusedEl.classList.remove(FOCUS_CLASS);
    focusedEl = null;
  }
  if (isItem(prev)) prev.onBlur?.();

  currentId = id;

  const next = nodes.get(id);
  if (isItem(next)) {
    if (next.el) {
      next.el.classList.add(FOCUS_CLASS);
      focusedEl = next.el;
    }
    next.onFocus?.();
  }
  markPath(id);
  listeners.forEach((fn) => fn(id));
}

/** Enfoca un id concreto; si es un contenedor baja hasta una hoja. */
export function setFocus(id: string): boolean {
  const target = descend(id);
  if (!target) return false;
  applyFocus(target);
  return true;
}

export function focusFirstIn(containerId: string): boolean {
  return setFocus(containerId);
}

export function exists(id: string): boolean {
  return nodes.has(id);
}

/** Nodo del DOM de un elemento enfocable, si sigue montado. */
export function getElement(id: string): HTMLElement | null {
  const node = nodes.get(id);
  if (!node) return null;
  return node.kind === 'item' ? node.el : node.el;
}

export function setPaused(value: boolean): void {
  paused = value;
}

/**
 * Radiografia del arbol de foco, para leerla desde el inspector de la TV.
 *
 * Senala los dos fallos que ya se han dado: contenedores sin hijos (enlace
 * padre-hijo roto) y nodos que dicen tener un padre que no existe.
 */
export function debugTree() {
  const lines: string[] = [];
  const problems: string[] = [];
  const empty: string[] = [];

  const walk = (id: string, depth: number) => {
    const node = nodes.get(id);
    if (!node) return;
    const pad = '  '.repeat(depth);
    const here = node.id === currentId ? '  <== FOCO' : '';
    if (node.kind === 'container') {
      lines.push(`${pad}[${node.orientation}] ${node.id} (${node.childIds.length} hijos)${here}`);
      // Un contenedor vacio es normal: las filas fuera de la ventana vertical
      // montan su armazon sin tarjetas. Se cuentan aparte para no confundirlo
      // con un enlace padre-hijo roto, que si es un fallo.
      if (node.childIds.length === 0) empty.push(node.id);
      node.childIds.forEach((c) => walk(c, depth + 1));
    } else {
      lines.push(`${pad}- ${node.id}${node.disabled ? ' (deshabilitado)' : ''}${here}`);
    }
  };

  const roots: string[] = [];
  nodes.forEach((node) => {
    if (!node.parentId) roots.push(node.id);
    else if (!nodes.has(node.parentId)) problems.push(`padre inexistente: ${node.id} -> ${node.parentId}`);
  });
  roots.forEach((r) => walk(r, 0));

  const marked = document.querySelectorAll('.' + FOCUS_CLASS).length;
  if (marked > 1) problems.push(`${marked} elementos con la clase de foco a la vez`);

  return {
    total: nodes.size,
    foco: currentId,
    raizActiva: activeRoot(),
    pilaDeRaices: [...rootStack],
    problemas: problems,
    contenedoresVacios: empty.length,
    arbol: lines.join('\n'),
  };
}

/** Solo para depurar desde la consola de la TV. */
export function __debugState() {
  return { count: nodes.size, currentId, rootStack: [...rootStack] };
}
