import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../services/api';

/**
 * Indice de lo que ya esta descargado en disco.
 *
 * La ficha necesita saber si un archivo esta bajado (para ofrecer Reproducir
 * en vez de Descargar) y su ruta real, que /api/search no devuelve. Se
 * consulta /api/files y se indexa por nombre normalizado y por carpeta: un
 * comprimido "Pelicula (1994).7z.001" acaba extraido como "Pelicula.1994.mkv"
 * dentro de la carpeta "Pelicula", asi que el nombre no coincide pero la
 * carpeta si.
 */

const EXTENSIONES = [
  '.rar', '.zip', '.7z', '.tar.gz', '.tar.bz2', '.tar', '.tgz', '.tbz2',
  '.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts',
];

export function normalizarNombre(nombre: string): string {
  let n = nombre.replace(/\.part\d+/i, '').replace(/\.\d{3,}$/, '');
  for (const ext of EXTENSIONES) {
    if (n.toLowerCase().endsWith(ext)) {
      n = n.slice(0, -ext.length);
      break;
    }
  }
  return n.trim().toLowerCase();
}

/** Misma regla que suggest_folder_name() del backend: asi se sabe en que carpeta ha caido. */
export function carpetaSugerida(nombre: string): string {
  let n = nombre.replace(/\.part\d+/i, '').replace(/\.r\d{2,}$/i, '').replace(/\.\d{3,}$/, '');
  for (const ext of EXTENSIONES) {
    if (n.toLowerCase().endsWith(ext)) { n = n.slice(0, -ext.length); break; }
  }
  n = n.replace(/[._\s]*(\d{1,2})x\d{1,3}[._\s]*/i, (_m, s) => ` S${parseInt(s)} `);
  n = n.replace(/[._\s]*[sS](\d{1,2})[eE]\d{1,3}[._\s]*/, (_m, s) => ` S${parseInt(s)} `);
  n = n.replace(/[._\s]*[eE]\d{1,3}[._\s]*/, ' ');
  n = n.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  return n.replace(/[<>:"/\\|?*]/g, '').trim().toLowerCase();
}

export interface EntradaBiblioteca {
  name: string;
  path: string;
  size?: string;
}

function episodioDe(nombre: string): string | null {
  const m = nombre.match(/(\d{1,2})x(\d{2,3})|[sS](\d{1,2})[eE](\d{1,3})/);
  if (!m) return null;
  return `${parseInt(m[1] || m[3])}:${parseInt(m[2] || m[4])}`;
}

export function useLibrary() {
  const [porNombre, setPorNombre] = useState<Map<string, EntradaBiblioteca>>(new Map());
  const [porCarpeta, setPorCarpeta] = useState<Map<string, EntradaBiblioteca[]>>(new Map());

  const recargar = useCallback(async () => {
    try {
      const res = await apiFetch('/files');
      const data = await res.json();
      const nombres = new Map<string, EntradaBiblioteca>();
      const carpetas = new Map<string, EntradaBiblioteca[]>();
      const anadir = (e: any) => {
        if (!e?.name || !e?.path || e.is_dir) return;
        const entrada = { name: e.name, path: e.path, size: e.size };
        nombres.set(normalizarNombre(e.name), entrada);
        const partes = String(e.path).split('/');
        const carpeta = (partes[partes.length - 2] || '').toLowerCase();
        if (carpeta) {
          if (!carpetas.has(carpeta)) carpetas.set(carpeta, []);
          carpetas.get(carpeta)!.push(entrada);
        }
      };
      for (const f of data.files || []) {
        anadir(f);
        for (const ep of f.episodes || []) anadir(ep);
      }
      setPorNombre(nombres);
      setPorCarpeta(carpetas);
    } catch { /* sin conexion: se mantiene lo anterior */ }
  }, []);

  useEffect(() => { recargar(); }, [recargar]);

  /** Ruta en disco de un archivo ya descargado, o undefined. */
  const rutaDe = useCallback((nombre?: string) => {
    if (!nombre) return undefined;
    const exacto = porNombre.get(normalizarNombre(nombre))?.path;
    if (exacto) return exacto;
    // Una pelicula comprimida: la carpeta tiene un solo video (y ni el archivo
    // pedido ni el que hay dentro son episodios de una serie).
    if (episodioDe(nombre)) return undefined;
    const carpeta = porCarpeta.get(carpetaSugerida(nombre));
    if (carpeta && carpeta.length === 1 && !episodioDe(carpeta[0].name)) return carpeta[0].path;
    return undefined;
  }, [porNombre, porCarpeta]);

  /** Ruta de un episodio concreto dentro de la carpeta de su temporada. */
  const rutaEpisodio = useCallback((nombre: string, season?: number, episode?: number) => {
    if (episode === undefined) return undefined;
    const exacto = porNombre.get(normalizarNombre(nombre))?.path;
    if (exacto) return exacto;
    const carpeta = porCarpeta.get(carpetaSugerida(nombre));
    if (!carpeta) return undefined;
    const clave = `${season ?? ''}:${episode}`;
    // Solo cuenta el archivo cuyo numero de episodio coincide. Nada de "si la
    // carpeta tiene un solo video es ese": con un unico episodio bajado, toda
    // la temporada salia como descargada apuntando al mismo archivo.
    const hit = carpeta.find((e) => episodioDe(e.name) === clave || (season === undefined && episodioDe(e.name)?.endsWith(`:${episode}`)));
    return hit?.path;
  }, [porNombre, porCarpeta]);

  return { rutaDe, rutaEpisodio, recargar, total: porNombre.size };
}
