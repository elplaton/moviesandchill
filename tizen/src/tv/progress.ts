/**
 * Posicion de reproduccion por archivo, en localStorage.
 *
 * Es lo que alimenta "Continuar viendo" y lo que hace que al abrir un video
 * empiece donde se dejo. Se guarda cada pocos segundos mientras se ve.
 */
export interface Watched {
  path: string;
  title: string;
  poster?: string;
  backdrop?: string;
  subtitle?: string;
  position: number;   // segundos
  duration: number;   // segundos
  updated: number;    // Date.now()
}

const KEY = 'mc.progress';
const MAX = 40;

function load(): Watched[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Watched[]) : [];
  } catch {
    return [];
  }
}

function save(list: Watched[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch { /* sin espacio */ }
}

export function getWatched(path: string): Watched | undefined {
  return load().find((w) => w.path === path);
}

export function setWatched(entry: Omit<Watched, 'updated'>) {
  const list = load().filter((w) => w.path !== entry.path);
  list.unshift({ ...entry, updated: Date.now() });
  save(list);
}

export function clearWatched(path: string) {
  save(load().filter((w) => w.path !== path));
}

/** Lo que esta a medias: mas de un minuto visto y menos del 95 %. */
export function continueWatching(): Watched[] {
  return load()
    .filter((w) => w.duration > 0 && w.position > 60 && w.position / w.duration < 0.95)
    .sort((a, b) => b.updated - a.updated);
}

/** Punto de reanudacion valido, o 0. */
export function resumePoint(path: string): number {
  const w = getWatched(path);
  if (!w || !w.duration) return 0;
  if (w.position < 60 || w.position / w.duration >= 0.95) return 0;
  return w.position;
}
