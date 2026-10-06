import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchMediaFiles } from '../services/media';
import type { BrowseItem, TMDBMetadata } from '../types';
import type { SheetInput } from '../components/TitleSheet';
import { useCarriles } from './useCarriles';

/** Identifica un título en la URL: 's' o 'm' delante del id de TMDB, porque
 *  los ids de películas y series son espacios independientes. */
function claveFicha(tmdbId: number, kind: 'movie' | 'series') {
  return `${kind === 'series' ? 's' : 'm'}${tmdbId}`;
}

function leerClave(clave: string): { tmdbId: number; kind: 'movie' | 'series' } | null {
  const m = /^([sm])(\d+)$/.exec(clave);
  if (!m) return null;
  return { tmdbId: parseInt(m[2], 10), kind: m[1] === 's' ? 'series' : 'movie' };
}

/**
 * Abrir la ficha de un título.
 *
 * La ficha vive **en la URL** (`?ficha=s1234`), no solo en el estado. Dos
 * razones: "atrás" cierra la ficha en vez de salirse de la portada (que era
 * justo lo que recargaba el inicio y perdía el scroll), y un aviso de episodio
 * nuevo puede abrir directamente el título con un enlace.
 *
 * Lo necesitan los carriles y también Favoritos, que no carga carriles y no
 * tiene por qué pedir /browse/home para esto.
 */
export function useSheet() {
  const [sheet, setSheet] = useState<SheetInput | null>(null);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const ficha = params.get('ficha');
  // Si la ficha la abrimos nosotros, cerrarla es un "atrás"; si se llegó con
  // el enlace de un aviso no hay a dónde volver y solo se quita el parámetro.
  const empujado = useRef(false);
  const cargando = useRef<string | null>(null);

  const abrirPorClave = useCallback(async (clave: string) => {
    const ref = leerClave(clave);
    if (!ref) return;
    cargando.current = clave;
    try {
      const { tmdb, results } = await fetchMediaFiles(ref.tmdbId, ref.kind);
      if (cargando.current !== clave) return;
      const meta: TMDBMetadata = tmdb || { title: '' };
      setSheet({ kind: ref.kind, tmdbId: ref.tmdbId, meta, files: results });
    } catch {
      if (cargando.current === clave) setSheet(null);
    }
  }, []);

  // La URL manda: así funcionan igual el clic, el enlace de un aviso y el
  // botón de atrás del navegador.
  useEffect(() => {
    if (!ficha) { cargando.current = null; setSheet(null); return; }
    // De esta ya se está encargando `open()`: sin esta guarda, poner el
    // parámetro en la URL dispararía una segunda petición de los archivos.
    if (cargando.current === ficha) return;
    if (sheet && claveFicha(sheet.tmdbId || 0, sheet.kind) === ficha) return;
    abrirPorClave(ficha);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ficha]);

  /** Abre la ficha de una tarjeta: primero la URL (para que "atrás" la cierre)
   *  y la ficha en cuanto se sepan sus archivos. */
  const open = useCallback(async (item: BrowseItem) => {
    const clave = claveFicha(item.tmdb_id, item.media_type);
    const meta: TMDBMetadata = {
      title: item.title, poster: item.poster, backdrop: item.backdrop,
      year: item.year, rating: item.rating, overview: item.overview, genres: item.genres,
    };
    cargando.current = clave;
    const siguiente = new URLSearchParams(params);
    siguiente.set('ficha', clave);
    empujado.current = true;
    setParams(siguiente);
    try {
      const { results } = await fetchMediaFiles(item.tmdb_id, item.media_type);
      if (cargando.current !== clave) return;
      setSheet({ kind: item.media_type, tmdbId: item.tmdb_id, meta, files: results });
    } catch {
      // Lo que ya se sabía del título vale para abrirla; sin archivos la ficha
      // lo dice, que es mejor que no abrirse al fallar la red.
      if (cargando.current === clave) {
        setSheet({ kind: item.media_type, tmdbId: item.tmdb_id, meta, files: [] });
      }
    }
  }, [params, setParams]);

  const cerrar = useCallback(() => {
    cargando.current = null;
    if (empujado.current) {
      empujado.current = false;
      navigate(-1);
      return;
    }
    const siguiente = new URLSearchParams(params);
    siguiente.delete('ficha');
    setParams(siguiente, { replace: true });
    setSheet(null);
  }, [navigate, params, setParams]);

  return { sheet, setSheet, open, cerrar };
}

/**
 * Carriles de la portada y apertura de fichas.
 *
 * Lo tenían copiado Home, Películas y Series con pequeñas diferencias; aquí
 * está una sola vez, con el filtro por tipo como parámetro. El filtro va al
 * servidor: filtrar en el cliente dejaba carriles de ocho tarjetas en cuanto
 * las páginas fueron de veinte.
 */
export function useCatalog(filter?: 'movie' | 'series') {
  const carriles = useCarriles(filter);
  const sheet = useSheet();
  return { ...carriles, ...sheet, rows: carriles.carriles };
}
