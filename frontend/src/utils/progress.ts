/**
 * Por donde va la cuenta en cada video.
 *
 * Esto vivia en el localStorage de cada aparato, y por eso no servia de mucho:
 * lo empezado en la tele no existia en el movil, y en la web ni siquiera habia
 * un sitio donde verlo. Ahora manda el servidor (`/api/progress`), igual que
 * con los favoritos. Lo que queda aqui es una cache **en memoria**, que se va
 * al recargar: guardarla en el navegador hacia que en un aparato compartido se
 * viera la fila de otra cuenta.
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

const MAX_EN_MEMORIA = 40;

/**
 * La ultima fila que dijo el servidor, **solo en memoria**.
 *
 * Antes esto era `localStorage`, y ahi estaba el problema: la fila es de la
 * cuenta y el navegador es del aparato. En un movil o una tele compartidos se
 * pintaba lo que habia visto otro (y sin red se quedaba ahi), asi que no se
 * guarda nada en disco: se vacia al recargar y al cambiar de cuenta, y el
 * servidor es el unico que sabe por donde va cada uno.
 *
 * Sigue haciendo falta: la ficha pregunta de forma sincrona si un archivo esta
 * a medias para decir "Continuar viendo" en vez de "Reproducir", y eso se
 * decide al pintar, sin tiempo de ir al servidor.
 */
let enMemoria: Watched[] = [];

// Lo que dejaron las versiones anteriores en el navegador se borra al cargar:
// era historial de la cuenta —y a veces de OTRA cuenta— guardado en el
// aparato, y ya no lo lee nadie.
for (const vieja of ['mc.continuar', 'mc.progress', 'mc.continuar.migrado']) {
  try { localStorage.removeItem(vieja); } catch { /* sin localStorage */ }
}

function leerCache(): Watched[] {
  return enMemoria;
}

function escribirCache(lista: Watched[]) {
  enMemoria = lista.slice(0, MAX_EN_MEMORIA);
}

/**
 * Olvida lo que haya en memoria. Se llama al entrar y al salir de una cuenta.
 */
export function olvidarCache() {
  enMemoria = [];
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

/**
 * Vacia el historial entero de la cuenta.
 *
 * Existe por un accidente: hubo una version que subia a la cuenta el historial
 * que el navegador tenia guardado de cuando el progreso vivia en localStorage,
 * y ese historial es del **aparato**, asi que en una tele o un movil
 * compartidos le entraba a uno lo que habia visto otro. Quitar aquello impide
 * que entren mas, pero no borra las que entraron, y hacerlo tarjeta a tarjeta
 * es un castigo. No se pierde nada que no se reconstruya viendo: no toca el
 * disco ni las descargas.
 */
export async function clearAllWatched() {
  olvidarCache();
  await apiFetch('/progress?todo=true', { method: 'DELETE' });
}

/** Olvida el titulo entero ("quitar de Continuar viendo"). */
export async function clearWatched(path: string) {
  escribirCache(leerCache().filter((w) => w.path !== path));
  try {
    await apiFetch(`/progress?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
  } catch { /* se reintenta la proxima vez */ }
}
