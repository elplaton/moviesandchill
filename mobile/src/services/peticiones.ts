/*
 * Peticiones: pedir lo que no esta en el catalogo.
 *
 * Lo decide todo el servidor (si ya lo tenemos, si ya esta pedido, el limite
 * diario, a que chat va): aqui solo estan las llamadas y sus tipos. Las rutas
 * van sin `/api` porque apiFetch ya lo pone (ver lo de `/api/api/progress`).
 */
import { apiFetch } from './api';

export type EstadoPeticion = 'enviada' | 'conseguida' | 'fallida';
/** Tipo del cliente, no el de TMDB: `series`, no `tv`. */
export type TipoPeticion = 'movie' | 'series';

export interface ResultadoPeticion {
  tmdb_id: number;
  media_type: TipoPeticion;
  title: string;
  original_title: string;
  year: number | null;
  poster: string | null;
  overview: string;
  en_catalogo: boolean;
  peticion: null | { estado: EstadoPeticion; mia: boolean };
}

export interface MiPeticion {
  id: number;
  tmdb_id: number;
  media_type: TipoPeticion;
  titulo: string;
  year: number | null;
  poster: string | null;
  estado: EstadoPeticion;
  creada_en: string | null;
  conseguida_en: string | null;
  pedida_en: string | null;
  /** Si la mando esta cuenta (y no se sumo a la de otro). */
  origen: boolean;
}

export interface PeticionAdmin {
  id: number;
  tmdb_id: number;
  media_type: TipoPeticion;
  titulo: string;
  year: number | null;
  poster: string | null;
  estado: EstadoPeticion;
  chat_nombre: string | null;
  error: string | null;
  creada_en: string | null;
  conseguida_en: string | null;
  usuarios: string[];
}

export interface AjustesPeticiones {
  chat_id: number | null;
  chat_nombre: string;
  plantilla: string;
  plantilla_por_defecto: string;
  huecos: Record<string, string>;
  ejemplo: unknown;
  limite_dia: number;
}

export interface ChatDestino {
  id: number;
  nombre: string;
  tipo: 'canal' | 'grupo' | 'bot' | 'persona';
  usuario: string | null;
  puede_escribir: boolean;
  del_catalogo: boolean;
}

/** Error con el texto del servidor, que ya viene en español. */
async function fallo(r: Response, porDefecto: string): Promise<never> {
  let detalle = porDefecto;
  try { detalle = (await r.json()).detail || porDefecto; } catch {}
  throw new Error(detalle);
}

async function json<T>(r: Response, porDefecto: string): Promise<T> {
  if (!r.ok) return fallo(r, porDefecto);
  return r.json();
}

export async function buscarParaPedir(q: string): Promise<ResultadoPeticion[]> {
  const d = await json<{ results: ResultadoPeticion[] }>(
    await apiFetch(`/peticiones/buscar?q=${encodeURIComponent(q)}`), 'No se ha podido buscar');
  return d.results || [];
}

export async function pedir(tmdb_id: number, media_type: TipoPeticion): Promise<{ estado: EstadoPeticion; ya_pedida: boolean }> {
  return json(await apiFetch('/peticiones', { method: 'POST', body: JSON.stringify({ tmdb_id, media_type }) }),
    'No se ha podido pedir');
}

export async function misPeticiones(): Promise<{ peticiones: MiPeticion[]; quedan_hoy: number | null }> {
  return json(await apiFetch('/peticiones'), 'No se han podido cargar tus peticiones');
}

export async function dejarDeEsperar(id: number): Promise<void> {
  await json(await apiFetch(`/peticiones/${id}`, { method: 'DELETE' }), 'No se ha podido quitar');
}

export async function peticionesAdmin(): Promise<{ peticiones: PeticionAdmin[]; ajustes: AjustesPeticiones }> {
  return json(await apiFetch('/admin/peticiones'), 'No se han podido cargar las peticiones');
}

export async function chatsDestino(): Promise<ChatDestino[]> {
  const d = await json<{ chats: ChatDestino[] }>(await apiFetch('/admin/peticiones/chats'), 'No se han podido cargar los chats');
  return d.chats || [];
}

export async function guardarAjustes(cambios: { chat_id?: number; chat_nombre?: string; plantilla?: string }): Promise<AjustesPeticiones> {
  return json(await apiFetch('/admin/peticiones/ajustes', { method: 'POST', body: JSON.stringify(cambios) }),
    'No se han podido guardar');
}

export async function vistaPrevia(plantilla: string): Promise<string> {
  const d = await json<{ texto: string }>(
    await apiFetch('/admin/peticiones/vista-previa', { method: 'POST', body: JSON.stringify({ plantilla }) }),
    'No se ha podido generar la vista previa');
  return d.texto || '';
}

export const TIPO_PETICION: Record<TipoPeticion, string> = { movie: 'Película', series: 'Serie' };
