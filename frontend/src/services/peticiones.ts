import { apiFetch } from './api';

/**
 * Pedir lo que no tenemos (ver backend/app/services/peticiones.py): se busca
 * en TMDB, la peticion entra en una cola y el servidor manda **una a la hora**
 * al chat de Telegram que haya elegido el admin; cuando el titulo aparece en
 * el catalogo, llega un aviso. Es el gemelo de `mobile/src/services/peticiones.ts`.
 *
 * Ojo: `apiFetch` ya pone `/api`, asi que las rutas van sin el prefijo.
 */
export type EstadoPeticion = 'en_cola' | 'enviada' | 'conseguida' | 'fallida' | 'descartada';

/**
 * Si ya esta pedida: en cola cuenta igual que mandada. Para quien mira la
 * tarjeta da lo mismo que el mensaje haya salido o este esperando su hora;
 * lo que importa es que no hace falta volver a pedirla («Pedida» si es mia,
 * «Avisarme» si es de otro).
 */
export function estaPedida(estado: EstadoPeticion | null | undefined): boolean {
  return estado === 'en_cola' || estado === 'enviada';
}

export interface ResultadoTmdb {
  tmdb_id: number;
  media_type: 'movie' | 'series';
  title: string;
  original_title: string;
  year: number | null;
  poster: string | null;
  overview: string;
  en_catalogo: boolean;
  peticion: { estado: EstadoPeticion; mia: boolean } | null;
}

export interface Peticion {
  id: number;
  tmdb_id: number;
  media_type: 'movie' | 'series';
  titulo: string;
  year: number | null;
  poster: string | null;
  estado: EstadoPeticion;
  creada_en: string | null;
  conseguida_en: string | null;
  pedida_en?: string | null;
  chat_nombre?: string | null;
  error?: string | null;
  usuarios?: string[];
  /** Su sitio en la cola (1 = la siguiente que sale); null si no esta en cola. */
  puesto?: number | null;
  /** Solo en el panel: cuando se intento mandar por ultima vez. */
  intento_en?: string | null;
}

/** Lo que hace falta para decir cuando sale cada una de la cola. */
export interface RitmoCola {
  /** Cuanto falta para que salga la primera (0 = en el proximo minuto). */
  segundos_para_siguiente: number;
  minutos_entre_envios: number;
  /** El admin ha pausado la publicación: la cola se llena pero no sale nada. */
  pausadas?: boolean;
}

export interface ColaAdmin extends RitmoCola {
  /** Con tantas o mas en cola, el panel avisa de que crece. */
  aviso_a_partir_de: number;
}

export interface RespuestaPedir {
  estado: 'en_cola' | 'enviada';
  ya_pedida: boolean;
  puesto: number | null;
}

export interface AjustesPeticiones {
  chat_id: number | null;
  chat_nombre: string;
  /** El tema del grupo (si es un foro) donde se escribe; null = General. */
  tema_id: number | null;
  tema_nombre: string;
  plantilla: string;
  plantilla_por_defecto: string;
  huecos: Record<string, string>;
  ejemplo: string;
  limite_dia: number;
}

export interface ChatTelegram {
  id: number;
  nombre: string;
  tipo: 'canal' | 'grupo' | 'bot' | 'persona';
  usuario: string | null;
  puede_escribir: boolean;
  /** Canal que se indexa, o grupo de conversación de uno de ellos. */
  del_catalogo: boolean;
  /** Si es el grupo de conversación de un canal del catálogo, cuál. */
  grupo_de: string | null;
  /** Grupo con temas: hay que elegir también en cuál se escribe. */
  foro: boolean;
}

export interface TemaForo {
  id: number;
  titulo: string;
  cerrado: boolean;
  general: boolean;
}

/** Lo que el servidor cuenta cuando dice que no (limite, chat sin elegir…). */
async function motivo(res: Response): Promise<string> {
  try {
    const d = await res.json();
    if (typeof d.detail === 'string') return d.detail;
  } catch { /* sin cuerpo */ }
  return 'No se ha podido hacer';
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(await motivo(res));
  return res.json();
}

export async function buscarEnTmdb(q: string): Promise<ResultadoTmdb[]> {
  const d = await json<{ results: ResultadoTmdb[] }>(await apiFetch(`/peticiones/buscar?q=${encodeURIComponent(q)}`));
  return d.results || [];
}

export async function pedir(r: Pick<ResultadoTmdb, 'tmdb_id' | 'media_type'>): Promise<RespuestaPedir> {
  return json(await apiFetch('/peticiones', {
    method: 'POST', body: JSON.stringify({ tmdb_id: r.tmdb_id, media_type: r.media_type }),
  }));
}

export async function misPeticiones(): Promise<{ peticiones: Peticion[]; quedan_hoy: number | null } & RitmoCola> {
  return json(await apiFetch('/peticiones'));
}

/** Cuanto falta, aproximadamente, para que salga la del puesto N. */
export function segundosHastaPuesto(puesto: number, ritmo: RitmoCola): number {
  return ritmo.segundos_para_siguiente + Math.max(0, puesto - 1) * ritmo.minutos_entre_envios * 60;
}

/**
 * Un tiempo en corto y redondeado («40 min», «2 h»): es una estimacion, y
 * decir «1 h 37 min» prometeria una precision que no hay (el admin puede
 * mover la cola o mandar una antes de su hora).
 */
export function duracionAprox(segundos: number): string {
  const min = Math.round(segundos / 60);
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  return `${Math.round(min / 60)} h`;
}

/** «saldrá …»: lo mismo que `duracionAprox`, dicho en una frase. */
export function cuandoSale(segundos: number): string {
  const min = Math.round(segundos / 60);
  if (min < 1) return 'en el próximo minuto';
  if (min < 60) return `en unos ${min} min`;
  const h = Math.round(min / 60);
  return h === 1 ? 'en una hora' : `en unas ${h} h`;
}

/**
 * El mensaje que se enseña al pedir. `POST /peticiones` dice el puesto pero no
 * el ritmo de la cola, asi que se pregunta aparte; si esa lectura falla basta
 * con el puesto, que es lo que de verdad dice cuanto falta.
 */
export async function avisoAlPedir(r: RespuestaPedir): Promise<string> {
  if (r.ya_pedida) return 'Ya estaba pedida: te avisaremos también a ti';
  if (r.estado !== 'en_cola') return 'Pedida: te avisaremos cuando esté';
  if (!r.puesto) return 'En cola: te avisaremos cuando esté';
  try {
    const ritmo = await misPeticiones();
    if (ritmo.pausadas) {
      return `En cola (puesto ${r.puesto}): la publicación está en pausa y saldrá cuando se reanude. Te avisaremos cuando esté`;
    }
    return `En cola (puesto ${r.puesto}): saldrá ${cuandoSale(segundosHastaPuesto(r.puesto, ritmo))}. Te avisaremos cuando esté`;
  } catch {
    return `En cola (puesto ${r.puesto}). Te avisaremos cuando esté`;
  }
}

export async function dejarDeEsperar(id: number): Promise<void> {
  await json(await apiFetch(`/peticiones/${id}`, { method: 'DELETE' }));
}

export async function peticionesAdmin(): Promise<{ peticiones: Peticion[]; ajustes: AjustesPeticiones; cola: ColaAdmin }> {
  return json(await apiFetch('/admin/peticiones'));
}

/** Cambiar el orden de la cola: un puesto arriba o abajo, o ponerla la primera. */
export async function moverEnCola(id: number, como: 'arriba' | 'abajo' | 'primera'): Promise<void> {
  await json(await apiFetch(`/admin/peticiones/${id}/mover`, { method: 'POST', body: JSON.stringify({ como }) }));
}

/** Mandarla ya, sin esperar su turno. Si Telegram no la deja salir, vuelve `fallida` con el motivo. */
export async function enviarYa(id: number): Promise<{ estado: EstadoPeticion | null; error: string | null }> {
  return json(await apiFetch(`/admin/peticiones/${id}/enviar`, { method: 'POST' }));
}

/** Sacarla de la cola sin mandarla (queda `descartada`). */
export async function quitarDeCola(id: number): Promise<void> {
  await json(await apiFetch(`/admin/peticiones/${id}/quitar`, { method: 'POST' }));
}

/** Volver a meter al final de la cola una `fallida` o `descartada`. */
export async function volverACola(id: number): Promise<void> {
  await json(await apiFetch(`/admin/peticiones/${id}/a-la-cola`, { method: 'POST' }));
}

export async function chatsTelegram(): Promise<ChatTelegram[]> {
  return (await json<{ chats: ChatTelegram[] }>(await apiFetch('/admin/peticiones/chats'))).chats;
}

export async function temasDe(chatId: number): Promise<TemaForo[]> {
  return (await json<{ temas: TemaForo[] }>(await apiFetch(`/admin/peticiones/temas?chat_id=${chatId}`))).temas;
}

/** Manda el mensaje de ejemplo a los Mensajes guardados de la cuenta de Telegram. */
export async function probarPeticion(plantilla?: string): Promise<string> {
  return (await json<{ texto: string }>(await apiFetch('/admin/peticiones/probar', {
    method: 'POST', body: JSON.stringify({ plantilla }),
  }))).texto;
}

export async function guardarAjustes(cambios: {
  chat_id?: number; chat_nombre?: string; tema_id?: number | null; tema_nombre?: string; plantilla?: string;
  pausadas?: boolean;
}): Promise<AjustesPeticiones> {
  return json(await apiFetch('/admin/peticiones/ajustes', { method: 'POST', body: JSON.stringify(cambios) }));
}

export async function vistaPrevia(plantilla: string): Promise<string> {
  return (await json<{ texto: string }>(await apiFetch('/admin/peticiones/vista-previa', {
    method: 'POST', body: JSON.stringify({ plantilla }),
  }))).texto;
}

export const ESTADO_TEXTO: Record<EstadoPeticion, string> = {
  en_cola: 'En cola',
  enviada: 'Pedida',
  conseguida: 'Ya está',
  fallida: 'No se pudo enviar',
  descartada: 'Descartada',
};
