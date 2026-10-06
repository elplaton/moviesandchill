/**
 * Por donde va la cuenta en cada video.
 *
 * Esto vivia en el localStorage de cada aparato, y por eso no servia de mucho:
 * lo empezado en la tele no existia en el movil, y en la web ni siquiera habia
 * un sitio donde verlo. Ahora manda el servidor (`/api/progress`), igual que
 * con los favoritos, y el localStorage se queda **solo como cache**: pinta la
 * fila al instante al abrir la app y aguanta un corte de red.
 *
 * Es el mismo archivo en `frontend/`, `mobile/` y `tizen/`.
 *
 * Las rutas van sin el prefijo /api: lo pone `apiFetch`. Con el escrito a mano
 * las peticiones salian a /api/api/progress, que no existe, y todo se quedaba
 * en la cache del navegador sin que el servidor viera nada.
 */
import { apiFetch } from '../services/api';

export interface Watched {
  path: string;
  title: string;
  subtitle?: string;
  poster?: string;
  backdrop?: string;
  position: number;   // segundos
  duration: number;   // segundos
  season?: number | null;
  episode?: number | null;
  tmdb_id?: number | null;
  media_type?: 'movie' | 'series';
  /** La tarjeta es el episodio siguiente (empieza de cero), no uno a medias. */
  next_episode?: boolean;
  grupo?: string;
}

/** Lo que el reproductor sabe del video que esta poniendo. */
export type Entrada = Omit<Watched, 'next_episode' | 'grupo'>;

const CACHE = 'mc.continuar';
const LEGACY = 'mc.progress';      // lo que guardaban las versiones anteriores
const MIGRADO = 'mc.continuar.migrado';

function leerCache(): Watched[] {
  try {
    const raw = localStorage.getItem(CACHE);
    return raw ? (JSON.parse(raw) as Watched[]) : [];
  } catch {
    return [];
  }
}

function escribirCache(lista: Watched[]) {
  try { localStorage.setItem(CACHE, JSON.stringify(lista.slice(0, 40))); } catch { /* sin espacio */ }
}

/** La fila tal y como quedo la ultima vez. Sirve para pintar sin esperar a la
 *  red; `continueWatching()` la refresca justo despues. */
export function cachedContinueWatching(): Watched[] {
  return leerCache();
}

/** La fila "Continuar viendo": una tarjeta por titulo, la monta el servidor. */
export async function continueWatching(): Promise<Watched[]> {
  try {
    const res = await apiFetch('/progress');
    if (!res.ok) return leerCache();
    const data = await res.json();
    const items: Watched[] = data.items || [];
    escribirCache(items);
    return items;
  } catch {
    // Sin red se enseña lo ultimo que se supo. Peor es dejar la fila vacia y
    // que parezca que se ha perdido todo.
    return leerCache();
  }
}

function puntoValido(w: Watched | undefined): number {
  if (!w?.duration) return 0;
  return w.position > 30 && w.position / w.duration < 0.95 ? w.position : 0;
}

/**
 * Lo mismo pero sin preguntar al servidor, para los sitios que lo necesitan
 * sincrono: la ficha mira si alguno de sus archivos esta a medias para decir
 * "Continuar viendo" en vez de "Reproducir", y eso se decide al pintar. Si la
 * cache esta fria dira "Reproducir", pero el reproductor reanuda igual porque
 * el punto lo pide al abrirse.
 */
export function cachedResumePoint(path: string): number {
  return puntoValido(leerCache().find((w) => w.path === path));
}

/** Por donde arrancar este archivo. 0 si es nuevo o si ya se vio entero. */
export async function resumePoint(path: string): Promise<number> {
  try {
    const res = await apiFetch(`/progress/point?path=${encodeURIComponent(path)}`);
    if (res.ok) return (await res.json()).position || 0;
  } catch { /* se cae a la cache */ }
  return cachedResumePoint(path);
}

function enviar(e: Entrada, keepalive = false) {
  // Sin await a proposito: guardar la posicion no debe frenar el reproductor,
  // y si falla una vez la siguiente (cada pocos segundos) lo arregla.
  apiFetch('/progress', {
    method: 'POST',
    body: JSON.stringify({
      path: e.path, position: e.position, duration: e.duration,
      title: e.title, subtitle: e.subtitle, poster: e.poster, backdrop: e.backdrop,
      tmdb_id: e.tmdb_id ?? null, media_type: e.media_type ?? null,
    }),
    keepalive,
  }).catch(() => {});

  const lista = leerCache().filter((w) => w.path !== e.path);
  lista.unshift({ ...e });
  escribirCache(lista);
}

/**
 * Guarda la posicion. `keepalive` para el ultimo guardado al cerrar: sin el,
 * el navegador cancela la peticion en cuanto se va la pagina y se pierde justo
 * el minuto por el que se dejo la pelicula, que es el que importa.
 */
export function setWatched(e: Entrada, keepalive = false) {
  enviar(e, keepalive);
}

/**
 * Da el video por visto. **No se borra**: una fila terminada es lo que permite
 * ofrecer el episodio siguiente. Quien lo quita de la fila es el servidor.
 */
export function markWatched(e: Entrada) {
  enviar({ ...e, position: e.duration || e.position }, true);
}

/** Olvida el titulo entero ("quitar de Continuar viendo"). */
export async function clearWatched(path: string) {
  escribirCache(leerCache().filter((w) => w.path !== path));
  try {
    await apiFetch(`/progress?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
  } catch { /* se reintenta la proxima vez */ }
}

/**
 * Sube una sola vez lo que este aparato tenia guardado de antes, para que al
 * actualizar nadie pierda por donde iba.
 */
export async function importLocalProgress() {
  let viejo: Watched[] = [];
  try {
    if (localStorage.getItem(MIGRADO)) return;
    viejo = JSON.parse(localStorage.getItem(LEGACY) || '[]');
  } catch { return; }
  if (!viejo.length) {
    try { localStorage.setItem(MIGRADO, '1'); } catch { /* da igual */ }
    return;
  }
  try {
    const res = await apiFetch('/progress/import', {
      method: 'POST',
      body: JSON.stringify({
        items: viejo
          .filter((w) => w.path && w.duration > 0)
          .map((w) => ({ path: w.path, position: w.position, duration: w.duration,
                         title: w.title, subtitle: w.subtitle,
                         poster: w.poster, backdrop: w.backdrop })),
      }),
    });
    if (!res.ok) return;          // se reintenta en el proximo arranque
    localStorage.setItem(MIGRADO, '1');
    localStorage.removeItem(LEGACY);
  } catch { /* se reintenta en el proximo arranque */ }
}
