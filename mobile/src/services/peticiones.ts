/*
 * Peticiones: pedir lo que no esta en el catalogo.
 *
 * Lo decide todo el servidor (si ya lo tenemos, si ya esta pedido, el limite
 * diario, a que chat va): aqui solo estan las llamadas y sus tipos. Las rutas
 * van sin `/api` porque apiFetch ya lo pone (ver lo de `/api/api/progress`).
 */
import { apiFetch } from './api';

/**
 * `en_cola`: pedida, esperando su turno (el servidor manda una a la hora en
 * total, no una por cuenta). `descartada`: el admin la quito de la cola sin
 * mandarla. Para quien mira si «ya esta pedida», `en_cola` y `enviada` son lo
 * mismo: ver `estaPedida()`.
 */
export type EstadoPeticion = 'en_cola' | 'enviada' | 'conseguida' | 'fallida' | 'descartada';
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
  /** Solo en las `en_cola`: 1 = la siguiente que sale. */
  puesto: number | null;
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
  /** Ultima vez que se intento mandar (la de una fallida, cuando fallo). */
  intento_en: string | null;
  /** Solo en las `en_cola`. */
  puesto: number | null;
  usuarios: string[];
}

/** Como va la cola: cuanto falta para el siguiente envio y cada cuanto salen. */
export interface EstadoCola {
  segundos_para_siguiente: number;
  minutos_entre_envios: number;
  /** A partir de cuantas en cola el servidor avisa al admin. */
  aviso_a_partir_de: number;
  /** El admin ha pausado la publicación: la cola se llena pero no sale nada. */
  pausadas?: boolean;
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
  ejemplo: unknown;
  limite_dia: number;
}

export interface ChatDestino {
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

export interface Pedida {
  estado: 'en_cola' | 'enviada';
  ya_pedida: boolean;
  puesto: number | null;
}

export async function pedir(tmdb_id: number, media_type: TipoPeticion): Promise<Pedida> {
  return json(await apiFetch('/peticiones', { method: 'POST', body: JSON.stringify({ tmdb_id, media_type }) }),
    'No se ha podido pedir');
}

export interface MisPeticiones {
  peticiones: MiPeticion[];
  quedan_hoy: number | null;
  segundos_para_siguiente: number;
  minutos_entre_envios: number;
  pausadas?: boolean;
}

export async function misPeticiones(): Promise<MisPeticiones> {
  return json(await apiFetch('/peticiones'), 'No se han podido cargar tus peticiones');
}

/** Ya esta pedida (por mi o por otro): en la cola o mandada a Telegram. Para
 *  quien pide da igual cual de las dos; las dos dicen «Pedida» o «Avisarme». */
export const estaPedida = (estado: EstadoPeticion | null | undefined) =>
  estado === 'en_cola' || estado === 'enviada';

/** Segundos que faltan para que salga la del puesto N: la siguiente sale en
 *  `segundos_para_siguiente` y cada una de detras, un hueco mas tarde. */
export const segundosHastaPuesto = (puesto: number, segundos: number, minutos: number) =>
  Math.max(0, segundos) + Math.max(0, puesto - 1) * minutos * 60;

/** «en el próximo minuto», «en unos 40 min», «en una hora», «en unas 3 h».
 *  Es una estimacion (el admin puede reordenar la cola), asi que se redondea
 *  a lo que se diria de palabra y no se da la hora exacta. */
export function enCuanto(segundos: number): string {
  if (segundos < 60) return 'en el próximo minuto';
  const min = Math.round(segundos / 60);
  if (min < 55) return `en unos ${min} min`;
  const h = Math.round(min / 60);
  return h <= 1 ? 'en una hora' : `en unas ${h} h`;
}

/** «una cada hora» / «una cada 30 min». */
export const ritmo = (minutos: number) => minutos === 60 ? 'una cada hora'
  : minutos % 60 === 0 ? `una cada ${minutos / 60} h` : `una cada ${minutos} min`;

/**
 * El texto del aviso al pedir. El POST da el puesto pero no el ritmo de la
 * cola, asi que para decir cuando sale se pregunta `GET /peticiones` (una
 * consulta mas, solo al pedir); si falla, se dice el puesto y basta.
 */
export async function textoAlPedir(d: Pedida): Promise<string> {
  if (d.ya_pedida) return 'Ya estaba pedida: te avisaremos también a ti';
  if (d.estado !== 'en_cola' || !d.puesto) return 'Pedida: te avisaremos cuando esté';
  let cuando = '';
  try {
    const m = await misPeticiones();
    cuando = m.pausadas ? ': la publicación está en pausa y saldrá cuando se reanude'
      : `: saldrá ${enCuanto(segundosHastaPuesto(d.puesto, m.segundos_para_siguiente, m.minutos_entre_envios))}`;
  } catch {}
  return `En cola (puesto ${d.puesto})${cuando}. Te avisaremos cuando esté`;
}

export async function dejarDeEsperar(id: number): Promise<void> {
  await json(await apiFetch(`/peticiones/${id}`, { method: 'DELETE' }), 'No se ha podido quitar');
}

export async function peticionesAdmin(): Promise<{ peticiones: PeticionAdmin[]; ajustes: AjustesPeticiones; cola: EstadoCola }> {
  return json(await apiFetch('/admin/peticiones'), 'No se han podido cargar las peticiones');
}

/** Cambiar el orden de una de la cola. */
export async function moverEnCola(id: number, como: 'arriba' | 'abajo' | 'primera'): Promise<void> {
  await json(await apiFetch(`/admin/peticiones/${id}/mover`, { method: 'POST', body: JSON.stringify({ como }) }),
    'No se ha podido mover');
}

/** Mandarla ya, sin esperar su turno. Si Telegram no la deja salir vuelve
 *  `fallida` con el motivo (no es un error HTTP: la peticion se proceso). */
export async function enviarYa(id: number): Promise<{ estado: EstadoPeticion | null; error: string | null }> {
  return json(await apiFetch(`/admin/peticiones/${id}/enviar`, { method: 'POST' }), 'No se ha podido enviar');
}

/** Sacarla de la cola sin mandarla (queda `descartada`). */
export async function quitarDeCola(id: number): Promise<void> {
  await json(await apiFetch(`/admin/peticiones/${id}/quitar`, { method: 'POST' }), 'No se ha podido quitar de la cola');
}

/** Volver a poner al final de la cola una `fallida` o `descartada`. */
export async function volverALaCola(id: number): Promise<void> {
  await json(await apiFetch(`/admin/peticiones/${id}/a-la-cola`, { method: 'POST' }), 'No se ha podido volver a la cola');
}

export async function chatsDestino(): Promise<ChatDestino[]> {
  const d = await json<{ chats: ChatDestino[] }>(await apiFetch('/admin/peticiones/chats'), 'No se han podido cargar los chats');
  return d.chats || [];
}

export async function temasDe(chatId: number): Promise<TemaForo[]> {
  const d = await json<{ temas: TemaForo[] }>(await apiFetch(`/admin/peticiones/temas?chat_id=${chatId}`),
    'No se han podido leer los temas');
  return d.temas || [];
}

/** Manda el mensaje de ejemplo a los Mensajes guardados de la cuenta de Telegram. */
export async function probarPeticion(plantilla?: string): Promise<void> {
  await json(await apiFetch('/admin/peticiones/probar', { method: 'POST', body: JSON.stringify({ plantilla }) }),
    'No se ha podido mandar la prueba');
}

export async function guardarAjustes(cambios: {
  chat_id?: number; chat_nombre?: string; tema_id?: number | null; tema_nombre?: string; plantilla?: string;
  pausadas?: boolean;
}): Promise<AjustesPeticiones> {
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

export const ESTADO_TEXTO: Record<EstadoPeticion, string> = {
  en_cola: 'En cola',
  enviada: 'Pedida',
  conseguida: 'Ya está',
  fallida: 'Falló',
  descartada: 'Descartada',
};
