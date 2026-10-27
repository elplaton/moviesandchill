import { apiFetch } from './api';

/**
 * Pedir lo que no tenemos (ver backend/app/services/peticiones.py): se busca
 * en TMDB, se manda un mensaje al chat de Telegram que haya elegido el admin
 * y, cuando el titulo aparece en el catalogo, llega un aviso. Es el gemelo de
 * `mobile/src/services/peticiones.ts`.
 *
 * Ojo: `apiFetch` ya pone `/api`, asi que las rutas van sin el prefijo.
 */
export type EstadoPeticion = 'enviada' | 'conseguida' | 'fallida';

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

export async function pedir(r: Pick<ResultadoTmdb, 'tmdb_id' | 'media_type'>): Promise<{ ya_pedida: boolean }> {
  return json(await apiFetch('/peticiones', {
    method: 'POST', body: JSON.stringify({ tmdb_id: r.tmdb_id, media_type: r.media_type }),
  }));
}

export async function misPeticiones(): Promise<{ peticiones: Peticion[]; quedan_hoy: number | null }> {
  return json(await apiFetch('/peticiones'));
}

export async function dejarDeEsperar(id: number): Promise<void> {
  await json(await apiFetch(`/peticiones/${id}`, { method: 'DELETE' }));
}

export async function peticionesAdmin(): Promise<{ peticiones: Peticion[]; ajustes: AjustesPeticiones }> {
  return json(await apiFetch('/admin/peticiones'));
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
}): Promise<AjustesPeticiones> {
  return json(await apiFetch('/admin/peticiones/ajustes', { method: 'POST', body: JSON.stringify(cambios) }));
}

export async function vistaPrevia(plantilla: string): Promise<string> {
  return (await json<{ texto: string }>(await apiFetch('/admin/peticiones/vista-previa', {
    method: 'POST', body: JSON.stringify({ plantilla }),
  }))).texto;
}

export const ESTADO_TEXTO: Record<EstadoPeticion, string> = {
  enviada: 'Pedida',
  conseguida: 'Ya está',
  fallida: 'No se pudo enviar',
};
