/**
 * Entrada del mando: mapa de teclas de Tizen y coalescido por frame.
 *
 * Al mantener pulsada una flecha la TV dispara keydown mucho mas rapido de lo
 * que se puede repintar. Si se atiende cada evento se encola trabajo y el foco
 * sigue moviendose despues de soltar: esa es buena parte de la sensacion de
 * "va con retraso". Aqui se procesa como mucho un movimiento por frame.
 */
import { move, enter, type Direction } from './engine';

/** Teclas de direccion: codigos estandar + los especificos de Tizen. */
const DIR_BY_CODE: Record<number, Direction> = {
  37: 'left', 10037: 'left',
  38: 'up', 10038: 'up',
  39: 'right', 10039: 'right',
  40: 'down', 10040: 'down',
};

const DIR_BY_KEY: Record<string, Direction> = {
  ArrowLeft: 'left',
  ArrowUp: 'up',
  ArrowRight: 'right',
  ArrowDown: 'down',
};

const ENTER_CODES = new Set([13, 10013]);
/** 10009 = tecla RETURN del mando Samsung. 461 la usan algunos modelos. */
const BACK_CODES = new Set([10009, 461]);
const BACK_KEYS = new Set(['Backspace', 'Escape', 'XF86Back', 'BrowserBack', 'GoBack']);

/** Por debajo de esto se considera repeticion: se corta la animacion. */
const FAST_REPEAT_MS = 220;
const FAST_CLASS = 'nav-fast';

let pendingDir: Direction | null = null;
let frame = 0;
let lastMoveAt = 0;
let fastTimer: ReturnType<typeof setTimeout> | null = null;

type BackHandler = () => boolean | void;
const backHandlers: BackHandler[] = [];

/** Teclas de reproduccion del mando (codigos de Tizen). */
export type MediaKey = 'playpause' | 'play' | 'pause' | 'stop' | 'rewind' | 'forward';
const MEDIA_BY_CODE: Record<number, MediaKey> = {
  10252: 'playpause', 415: 'play', 19: 'pause', 413: 'stop', 412: 'rewind', 417: 'forward',
};
type MediaHandler = (key: MediaKey) => boolean | void;
const mediaHandlers: MediaHandler[] = [];

/** El reproductor se registra aqui para recibir play/pausa/avance del mando. */
export function pushMediaHandler(handler: MediaHandler): () => void {
  mediaHandlers.push(handler);
  return () => {
    const i = mediaHandlers.lastIndexOf(handler);
    if (i !== -1) mediaHandlers.splice(i, 1);
  };
}

/**
 * Captura de teclas en bruto (reproductor): recibe la direccion antes que el
 * motor de foco y, si devuelve true, la consume. Asi las flechas saltan en el
 * video en vez de mover un foco que no hay.
 */
type RawHandler = (dir: Direction | 'enter') => boolean | void;
const rawHandlers: RawHandler[] = [];
export function pushRawHandler(handler: RawHandler): () => void {
  rawHandlers.push(handler);
  return () => {
    const i = rawHandlers.lastIndexOf(handler);
    if (i !== -1) rawHandlers.splice(i, 1);
  };
}

/**
 * Registra que hacer al pulsar Atras. El ultimo registrado manda (modales
 * primero). Devuelve la funcion para darse de baja.
 */
export function pushBackHandler(handler: BackHandler): () => void {
  backHandlers.push(handler);
  return () => {
    const i = backHandlers.lastIndexOf(handler);
    if (i !== -1) backHandlers.splice(i, 1);
  };
}

function markFast() {
  const now = Date.now();
  const isRepeat = now - lastMoveAt < FAST_REPEAT_MS;
  lastMoveAt = now;
  const root = document.documentElement;
  if (isRepeat) {
    if (!root.classList.contains(FAST_CLASS)) root.classList.add(FAST_CLASS);
    if (fastTimer) clearTimeout(fastTimer);
    fastTimer = setTimeout(() => {
      root.classList.remove(FAST_CLASS);
      fastTimer = null;
    }, FAST_REPEAT_MS);
  }
}

function flush() {
  frame = 0;
  const dir = pendingDir;
  pendingDir = null;
  if (!dir) return;
  markFast();
  move(dir);
}

function goBack() {
  for (let i = backHandlers.length - 1; i >= 0; i--) {
    const handled = backHandlers[i]();
    if (handled !== false) return;
  }
  exitApp();
}

export function exitApp() {
  try {
    const tizen = (window as unknown as { tizen?: any }).tizen;
    tizen?.application?.getCurrentApplication?.()?.exit?.();
  } catch {
    /* fuera de la TV no hay nada que cerrar */
  }
}

function onKeyDown(event: KeyboardEvent) {
  const code = event.keyCode;

  if (BACK_CODES.has(code) || BACK_KEYS.has(event.key)) {
    // El navegador usa Backspace para retroceder: si el foco esta en un input
    // hay que dejarlo borrar.
    const target = event.target as HTMLElement | null;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
    if (event.key === 'Backspace' && typing) return;
    event.preventDefault();
    goBack();
    return;
  }

  const media = MEDIA_BY_CODE[code];
  if (media) {
    event.preventDefault();
    for (let i = mediaHandlers.length - 1; i >= 0; i--) {
      if (mediaHandlers[i](media) !== false) return;
    }
    return;
  }

  const dir = DIR_BY_CODE[code] || DIR_BY_KEY[event.key];
  if (dir && rawHandlers.length) {
    const top = rawHandlers[rawHandlers.length - 1];
    if (top(dir)) { event.preventDefault(); return; }
  }
  if ((ENTER_CODES.has(code) || event.key === 'Enter') && rawHandlers.length) {
    const top = rawHandlers[rawHandlers.length - 1];
    if (top('enter')) { event.preventDefault(); return; }
  }

  if (dir) {
    const target = event.target as HTMLElement | null;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

    if (typing) {
      // Escribiendo, izquierda y derecha mueven el cursor del texto.
      if (dir === 'left' || dir === 'right') return;
      // Arriba y abajo salen del campo. Sin esto el motor se quedaba en pausa
      // (la pausa es lo que deja funcionar el cursor) y no habia forma de
      // bajar del usuario a la contrasena en el login.
      target.blur();
    }

    event.preventDefault();
    pendingDir = dir;
    if (!frame) frame = requestAnimationFrame(flush);
    return;
  }

  if (ENTER_CODES.has(code) || event.key === 'Enter') {
    event.preventDefault();
    enter();
  }
}

/**
 * Reserva las teclas del mando que Tizen no entrega por defecto. Sin esto las
 * de color y las de reproduccion nunca llegan a la app.
 */
function registerTizenKeys() {
  try {
    const tizen = (window as unknown as { tizen?: any }).tizen;
    const input = tizen?.tvinputdevice;
    if (!input) return;
    const supported: Array<{ name: string }> = input.getSupportedKeys?.() || [];
    const wanted = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop',
                    'MediaRewind', 'MediaFastForward', 'ColorF0Red'];
    const names = wanted.filter((w) => supported.some((s) => s.name === w));
    if (names.length) input.registerKeyBatch?.(names);
  } catch {
    /* no estamos en una TV */
  }
}

let installed = false;

export function installKeyHandling(): void {
  if (installed) return;
  installed = true;
  registerTizenKeys();
  // capture: true para ganar a cualquier handler de React antes de que burbujee.
  window.addEventListener('keydown', onKeyDown, true);
}

export function uninstallKeyHandling(): void {
  if (!installed) return;
  installed = false;
  window.removeEventListener('keydown', onKeyDown, true);
}
