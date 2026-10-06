/**
 * Avisos de episodios nuevos (Web Push).
 *
 * El camino tiene seis piezas: permiso del navegador, service worker,
 * suscripción, clave pública del servidor, cifrado y servicio de push del
 * fabricante. Aquí está solo la parte del cliente, y cada función devuelve un
 * texto cuando algo falla: son fallos que el usuario puede arreglar (dar
 * permiso, instalar la app) y callárselos deja un interruptor que no hace nada.
 *
 * El iPhone pone dos condiciones que no se pueden sortear: la app tiene que
 * estar **instalada en la pantalla de inicio** (iOS 16.4+) y el permiso se
 * pide con el dedo del usuario, nunca al cargar.
 *
 * Es el mismo archivo en `frontend/` y en `mobile/`.
 */
import { apiFetch } from './api';

/** De dónde sale la suscripción; solo sirve para leerlo en los registros. */
export type Origen = 'web' | 'm';

export interface EstadoAvisos {
  /** El navegador sabe hacer esto. */
  soportado: boolean;
  /** 'default' (sin preguntar), 'granted', 'denied'. */
  permiso: NotificationPermission;
  /** Este aparato está dado de alta en el servidor. */
  suscrito: boolean;
  /** El servidor tiene claves con las que suscribirse. */
  disponible: boolean;
  /** Si no se soporta, por qué. */
  motivo?: string;
}

function instalada(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

function porQueNo(): string | undefined {
  if (!('serviceWorker' in navigator)) return 'Este navegador no admite avisos.';
  if (!('PushManager' in window)) {
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    return iOS && !instalada()
      ? 'En el iPhone los avisos solo funcionan con la app instalada: Compartir → «Añadir a pantalla de inicio».'
      : 'Este navegador no admite avisos.';
  }
  if (!('Notification' in window)) return 'Este navegador no admite avisos.';
  return undefined;
}

export function soportaAvisos(): boolean {
  return !porQueNo();
}

/** La clave pública del servidor, en el formato que pide el navegador: llega
 *  en base64url y `subscribe()` quiere los bytes. */
function aBytes(base64url: string): ArrayBuffer {
  const base64 = (base64url + '==='.slice((base64url.length + 3) % 4))
    .replace(/-/g, '+').replace(/_/g, '/');
  const crudo = atob(base64);
  const buffer = new ArrayBuffer(crudo.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < crudo.length; i++) bytes[i] = crudo.charCodeAt(i);
  return buffer;
}

async function suscripcionActual(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

export async function estadoAvisos(): Promise<EstadoAvisos> {
  const motivo = porQueNo();
  if (motivo) {
    return { soportado: false, permiso: 'denied', suscrito: false, disponible: false, motivo };
  }
  let disponible = false;
  try {
    const d = await (await apiFetch('/push/key')).json();
    disponible = !!d.available;
  } catch { /* sin red: se asume que no */ }
  return {
    soportado: true,
    permiso: Notification.permission,
    suscrito: !!(await suscripcionActual()),
    disponible,
  };
}

/** Da de alta este aparato. Devuelve un texto si no se ha podido. */
export async function activarAvisos(origen: Origen): Promise<string | null> {
  const motivo = porQueNo();
  if (motivo) return motivo;

  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') {
    return permiso === 'denied'
      ? 'Los avisos están bloqueados para esta app en los ajustes del sistema.'
      : 'Hace falta dar permiso para los avisos.';
  }

  let clave = '';
  try {
    const d = await (await apiFetch('/push/key')).json();
    clave = d.key || '';
  } catch {
    return 'No se ha podido hablar con el servidor.';
  }
  if (!clave) return 'El servidor no tiene claves de aviso configuradas.';

  try {
    const reg = await navigator.serviceWorker.ready;
    // Si ya hay una suscripción hecha con otra clave pública no vale: se tira
    // y se hace otra, o el servicio de push rechaza todos los avisos.
    const vieja = await reg.pushManager.getSubscription();
    if (vieja) await vieja.unsubscribe().catch(() => {});
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: aBytes(clave),
    });
    const datos = sub.toJSON() as { endpoint?: string; keys?: { p256dh: string; auth: string } };
    if (!datos.endpoint || !datos.keys) return 'El navegador no ha dado una suscripción válida.';
    const res = await apiFetch('/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint: datos.endpoint, keys: datos.keys, app: origen }),
    });
    if (!res.ok) return 'El servidor no ha aceptado la suscripción.';
    return null;
  } catch (e) {
    return `No se ha podido suscribir: ${(e as Error).message || 'error del navegador'}`;
  }
}

export async function desactivarAvisos(): Promise<void> {
  const sub = await suscripcionActual();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  await apiFetch('/push/subscribe', {
    method: 'DELETE',
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});
}

/** Un aviso de prueba, que lo manda el servidor. */
export async function probarAvisos(): Promise<number> {
  try {
    const d = await (await apiFetch('/push/test', { method: 'POST' })).json();
    return d.sent || 0;
  } catch {
    return 0;
  }
}
