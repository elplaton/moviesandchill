/**
 * Los carriles de la portada: paginados y con memoria.
 *
 * Dos problemas resueltos aqui.
 *
 * **Las filas de genero se acababan a las veinte tarjetas.** El servidor
 * mandaba una muestra y ahi se terminaba el catalogo. Ahora cada fila sabe
 * cuantos titulos hay (`total`) y se piden de veinte en veinte al llegar al
 * final del carril. Para que el navegador no acabe con mil tarjetas montadas,
 * la fila es una **ventana**: al añadir por la derecha se sueltan las de la
 * izquierda, y si se vuelve hacia atras se piden otra vez. El carril compensa
 * el desplazamiento (`shift`), asi que quitar tarjetas no mueve lo que se esta
 * mirando.
 *
 * **Volver de una ficha recargaba la portada.** El estado vive en un modulo,
 * no en el componente: al volver a la pagina estan las mismas filas, con las
 * mismas tarjetas cargadas y en la misma posicion. Y es importante que sean
 * *las mismas*: el orden lo decide una semilla, asi que pedir la portada otra
 * vez devolveria un catalogo distinto y nada estaria donde se dejo.
 *
 * Es el mismo archivo en `frontend/` y en `mobile/` (alli el scroll vertical
 * lo guarda el armazon, que es quien tiene el contenedor que se desplaza).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../services/api';
import type { BrowseItem, BrowseRow } from '../types';

/** Lo que se pide cada vez que se llega al borde del carril. */
export const PAGINA = 20;
/** Tarjetas como maximo en memoria por carril. Cuatro paginas. */
export const VENTANA = 80;
/** A partir de cuanto tiempo se vuelve a pedir la portada al volver a ella. */
const FRESCO = 10 * 60 * 1000;

export interface Carril {
  genre: string;
  /** El genero con el que se piden mas paginas. null = fila que no se pagina. */
  key: string | null;
  items: BrowseItem[];
  total: number;
  /** Rango de puestos (globales) que hay en memoria: [desde, hasta). */
  desde: number;
  hasta: number;
  /**
   * Cuantas tarjetas se ha movido el contenido desde que se monto el carril
   * (positivo = se han quitado por la izquierda). Es lo que el carril usa para
   * corregir su scroll; se lleva aparte de `desde` porque lo que importa es
   * cuantas tarjetas se han ido de verdad, no cuantos puestos se han pedido.
   */
  shift: number;
}

interface Memoria {
  seed: string;
  carriles: Carril[];
  ts: number;
  /** Desplazamiento horizontal de cada carril. El vertical lo guarda el
   *  armazon (App.tsx), que es quien tiene el contenedor que se desplaza. */
  scrollX: Record<string, number>;
}

const memoria = new Map<string, Memoria>();

function clave(filter?: string) {
  return filter || 'inicio';
}

export function olvidarCarriles() {
  memoria.clear();
}

function aCarril(row: BrowseRow): Carril {
  const items = row.items || [];
  const total = row.total ?? items.length;
  return {
    genre: row.genre,
    key: row.key ?? null,
    items,
    total,
    desde: 0,
    // Puestos consumidos por la primera pagina, no tarjetas recibidas: si el
    // servidor quito una repetida, el puesto sigue gastado.
    hasta: Math.min(total, Math.max(items.length, PAGINA)),
    shift: 0,
  };
}

/** Mezcla una pagina nueva en la ventana del carril. Sin estado: es lo que se
 *  puede probar sin navegador. */
export function fusionar(c: Carril, nuevos: BrowseItem[], dir: 1 | -1,
                         offset: number, pedidos: number, total: number): Carril {
  const vistos = new Set(c.items.map(i => i.id));
  const limpios = nuevos.filter(i => !vistos.has(i.id));
  let items: BrowseItem[];
  let { desde, hasta, shift } = c;

  if (dir > 0) {
    items = [...c.items, ...limpios];
    hasta = Math.min(total, offset + pedidos);
    if (items.length > VENTANA) {
      const sobra = items.length - VENTANA;
      items = items.slice(sobra);
      desde += sobra;
      shift += sobra;
    }
  } else {
    items = [...limpios, ...c.items];
    desde = offset;
    shift -= limpios.length;
    if (items.length > VENTANA) {
      const sobra = items.length - VENTANA;
      items = items.slice(0, VENTANA);
      // Lo que se suelta por la derecha no mueve nada de lo que se esta viendo.
      hasta -= sobra;
    }
  }
  return { ...c, items, desde, hasta, total, shift };
}

export function hayMas(c: Carril, dir: 1 | -1): boolean {
  if (!c.key) return false;
  return dir > 0 ? c.hasta < c.total : c.desde > 0;
}

export function useCarriles(filter?: 'movie' | 'series') {
  const k = clave(filter);
  const guardado = memoria.get(k);
  const vigente = guardado && Date.now() - guardado.ts < FRESCO ? guardado : undefined;
  const [carriles, setCarriles] = useState<Carril[]>(vigente?.carriles || []);
  const [loading, setLoading] = useState(!vigente);
  const enVuelo = useRef(new Set<string>());

  // El estado del modulo es la copia buena: el componente solo lo refleja.
  const escribir = useCallback((lista: Carril[]) => {
    const m = memoria.get(k);
    memoria.set(k, {
      seed: m?.seed || '',
      carriles: lista,
      ts: m?.ts || Date.now(),
      scrollX: m?.scrollX || {},
    });
    setCarriles(lista);
  }, [k]);

  useEffect(() => {
    if (vigente) return;
    let vivo = true;
    setLoading(true);
    const seed = String(Math.floor(Math.random() * 1e9));
    const q = new URLSearchParams({ seed });
    if (filter) q.set('media_type', filter);
    apiFetch(`/browse/home?${q}`)
      .then(r => r.json())
      .then(d => {
        if (!vivo) return;
        const lista = ((d.rows || []) as BrowseRow[]).map(aCarril).filter(c => c.items.length > 0);
        memoria.set(k, { seed: d.seed || seed, carriles: lista, ts: Date.now(), scrollX: {} });
        setCarriles(lista);
      })
      .catch(() => {})
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);

  const cargarMas = useCallback(async (genre: string, dir: 1 | -1) => {
    const m = memoria.get(k);
    if (!m) return;
    const c = m.carriles.find(x => x.genre === genre);
    if (!c || !c.key || !hayMas(c, dir)) return;

    const id = `${genre}|${dir}`;
    if (enVuelo.current.has(id)) return;
    enVuelo.current.add(id);
    try {
      const offset = dir > 0 ? c.hasta : Math.max(0, c.desde - PAGINA);
      const pedidos = dir > 0 ? PAGINA : c.desde - offset;
      const q = new URLSearchParams({ genre: c.key, seed: m.seed,
                                      offset: String(offset), limit: String(pedidos) });
      if (filter) q.set('media_type', filter);
      const d = await (await apiFetch(`/browse/genre?${q}`)).json();
      const nuevos: BrowseItem[] = d.items || [];
      const actual = memoria.get(k);
      if (!actual) return;
      escribir(actual.carriles.map(x => {
        if (x.genre !== genre) return x;
        // Sin nada que traer por ese lado se cierra el borde, para no estar
        // preguntando lo mismo en cada scroll.
        if (!nuevos.length) return dir > 0 ? { ...x, total: x.hasta } : { ...x, desde: 0 };
        return fusionar(x, nuevos, dir, offset, pedidos, d.total ?? x.total);
      }));
    } catch {
      /* sin red: se reintenta al siguiente scroll */
    } finally {
      enVuelo.current.delete(id);
    }
  }, [k, filter, escribir]);

  // --- Memoria de scroll -------------------------------------------------
  const scrollXDe = useCallback((genre: string) => memoria.get(k)?.scrollX[genre] ?? 0, [k]);
  const recordarScrollX = useCallback((genre: string, x: number) => {
    const m = memoria.get(k);
    if (m) m.scrollX[genre] = x;
  }, [k]);

  return { carriles, loading, cargarMas, scrollXDe, recordarScrollX };
}
