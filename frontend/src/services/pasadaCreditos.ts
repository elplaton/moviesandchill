/*
 * La pasada completa de créditos (backend: services/pasada_creditos.py):
 * leerla, lanzarla, pausarla y decirla en palabras. El mismo archivo en
 * `frontend/` y `mobile/`; cada panel la pinta a su manera.
 */
import { apiFetch } from './api';

export interface Pasada {
  estado: 'parada' | 'en_marcha' | 'pausada' | 'terminada' | 'error';
  lanzada: boolean;
  total?: number;
  hechos?: number;
  quedan?: number | null;
  actuales?: string[];
  cediendo?: string | null;
  resultados?: Record<string, number>;
  segundos_restantes?: number;
}

export async function leerPasada(): Promise<Pasada | null> {
  try {
    const r = await apiFetch('/admin/creditos/pasada');
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export async function mandarPasada(accion: 'lanzar' | 'pausar'): Promise<Pasada | null> {
  try {
    const r = await apiFetch('/admin/creditos/pasada', { method: 'POST', body: JSON.stringify({ accion }) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/** Qué está haciendo, en una frase. */
export function estadoPasada(p: Pasada): string {
  if (p.estado === 'en_marcha') {
    if (p.cediendo === 'descarga') return 'Esperando: hay una descarga en marcha y tiene preferencia';
    if (p.cediendo === 'viendo') return 'Más despacio (una tarea): alguien está viendo algo';
    if (p.cediendo) return `Esperando: ${p.cediendo}`;
    return 'En marcha, tres a la vez';
  }
  if (p.estado === 'pausada') return p.lanzada ? 'En marcha' : 'En pausa';
  if (p.estado === 'terminada') return 'Terminada';
  if (p.estado === 'error') return 'Se ha parado por un error (mira los registros)';
  return (p.hechos ?? 0) > 0 ? 'En pausa' : 'Sin lanzar';
}

/** «unos 40 min», «unas 5 h», «1 día y 3 h». */
export function cuantoQueda(segundos?: number): string {
  if (!segundos) return '';
  const min = Math.round(segundos / 60);
  if (min < 60) return `faltan unos ${Math.max(1, min)} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `faltan unas ${h} h`;
  const d = Math.floor(h / 24), r = h % 24;
  return `faltan ${d} ${d === 1 ? 'día' : 'días'}${r ? ` y ${r} h` : ''}`;
}

const RESULTADOS: Record<string, string> = {
  hecho: 'con dato', sin_resultado: 'sin créditos claros', no_analizable: 'no se pueden analizar',
  ya: 'ya estaban', error: 'fallos pasajeros',
};

/** Lo de esta tanda: «812 con dato · 40 sin créditos claros…». */
export function resultadosPasada(p: Pasada): string {
  return Object.entries(p.resultados || {})
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n.toLocaleString('es-ES')} ${RESULTADOS[k] || k}`)
    .join(' · ');
}
