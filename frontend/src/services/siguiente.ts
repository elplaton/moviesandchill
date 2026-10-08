/*
 * El siguiente episodio: cuando preguntar y que preguntar.
 *
 * Es el mismo archivo en `frontend/`, `mobile/` y `tizen/`, como
 * `progress.ts` o `favorites.ts`: la decision la toma el servidor
 * (`/api/next-up`, ver `backend/app/services/siguiente.py`) y aqui solo esta
 * el cuando y el como se dibuja, que es lo unico que cambia entre un raton,
 * un dedo y un mando.
 *
 * Dos umbrales distintos, y la diferencia importa:
 *
 *   AVISO_BAJAR_S   Tres minutos antes del final. Es cuando se pregunta si
 *                   bajar los siguientes, y va tan temprano porque descargar
 *                   un capitulo tarda: preguntarlo en el ultimo segundo
 *                   garantiza la espera que se intenta evitar.
 *   AVISO_VER_S     Cuarenta y cinco segundos. Es la tarjeta de "siguiente
 *                   episodio", que solo tiene sentido pegada a los creditos.
 *
 * Y la cuenta atras de la barra (CUENTA_ATRAS_S) corre desde que aparece la
 * tarjeta, asi que el salto cae sobre los creditos y no cuando ya ha acabado
 * todo, que es lo que hace Netflix y lo que se pidio.
 *
 * Nada se descarga sin que alguien lo pulse. Lo unico que pasa solo es *ver*
 * el siguiente, que no gasta disco ni cuota.
 */
import { apiFetch } from './api';

/** Tres minutos para el final: hora de preguntar si se bajan los siguientes. */
export const AVISO_BAJAR_S = 180;
/** Cuarenta y cinco segundos: hora de ofrecer el siguiente. */
export const AVISO_VER_S = 45;
/** Lo que tarda en pasar solo al siguiente episodio. */
export const CUENTA_ATRAS_S = 15;

export interface SiguienteEpisodio {
  path: string;
  season: number | null;
  episode: number;
  label: string;
}

export interface Descargable {
  message_id: number;
  channel_id: number | null;
  file_name?: string;
  size: number;
  size_str: string;
  season: number | null;
  episode: number;
  label: string;
}

export interface QueViene {
  kind: 'series' | 'movie' | 'desconocido';
  tmdb_id?: number | null;
  grupo?: string;
  actual?: { season: number; episode: number; label: string };
  siguiente?: SiguienteEpisodio | null;
  /** Cuantos episodios quedan descargados por delante y sin ver. */
  pendientes?: number;
  descargables?: Descargable[];
  title?: string;
  poster?: string | null;
  backdrop?: string | null;
}

/** Que tarjeta toca: ninguna, la de ver el siguiente, o la de descargar. */
export type Decision =
  | { tipo: 'nada' }
  | { tipo: 'ver'; siguiente: SiguienteEpisodio; bajar: Descargable[] }
  | { tipo: 'bajar'; bajar: Descargable[] };

/**
 * La decision, a partir de lo que ha dicho el servidor.
 *
 * El orden no es arbitrario: si hay algo que ver **ya**, eso es lo primero
 * (una descarga es una espera y un archivo en disco no), y la oferta de bajar
 * viaja dentro de esa misma tarjeta como segundo boton. Solo cuando no hay
 * nada que ver se dedica la tarjeta a preguntar por la descarga.
 */
export function decidir(q: QueViene | null | undefined): Decision {
  if (!q || q.kind !== 'series') return { tipo: 'nada' };
  const bajar = q.descargables || [];
  if (q.siguiente) return { tipo: 'ver', siguiente: q.siguiente, bajar };
  if (bajar.length) return { tipo: 'bajar', bajar };
  return { tipo: 'nada' };
}

/** Que viene despues de este archivo. null si no se ha podido saber. */
export async function queViene(path: string, tmdbId?: number | null): Promise<QueViene | null> {
  try {
    const q = tmdbId ? `&tmdb_id=${tmdbId}` : '';
    const res = await apiFetch(`/next-up?path=${encodeURIComponent(path)}${q}`);
    if (!res.ok) return null;
    return (await res.json()) as QueViene;
  } catch {
    // Sin respuesta no se ofrece nada, que es exactamente como estaba antes
    // de que esto existiera: el capitulo acaba y se cierra el reproductor.
    return null;
  }
}

export interface Arrancadas {
  started: { label: string; folder_name?: string }[];
  errors: string[];
}

/**
 * Pone a descargar los proximos episodios.
 *
 * Cuantos lo decide el servidor (dos si no queda nada delante, uno si queda
 * la reserva) y vuelve a comprobar cuales son: entre que se pinto la tarjeta
 * y que alguien la pulso puede haberlos bajado otra cuenta.
 */
export async function bajarSiguientes(path: string, tmdbId?: number | null,
                                      count?: number): Promise<Arrancadas> {
  try {
    const res = await apiFetch('/next-up/download', {
      method: 'POST',
      body: JSON.stringify({ path, tmdb_id: tmdbId ?? null, count: count ?? null }),
    });
    if (!res.ok) return { started: [], errors: ['No se ha podido empezar la descarga'] };
    return (await res.json()) as Arrancadas;
  } catch {
    return { started: [], errors: ['Sin conexión con el servidor'] };
  }
}

/** «3x09 y 3x10», para el texto de los botones. */
export function listar(eps: { label: string }[]): string {
  const l = eps.map((e) => e.label);
  if (l.length <= 1) return l[0] || '';
  return `${l.slice(0, -1).join(', ')} y ${l[l.length - 1]}`;
}

/**
 * El resumen de lo que ha pasado al pulsar «descargar».
 *
 * Si algo ha arrancado se dice eso y se calla el resto: que uno de los dos
 * episodios no estuviera disponible no es un problema del que haya que
 * informar a quien solo quería seguir viendo la serie. Si no ha arrancado
 * nada, se dice **el motivo** —la cuota, que ya lo tenía otro— porque «no se
 * ha podido» a secas es lo que hace pensar que la app está rota.
 */
export function resumen(r: Arrancadas): string {
  if (r.started.length) return `Descargando ${listar(r.started)}`;
  return r.errors[0] || 'No había nada que descargar';
}
