import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../services/api';

/**
 * Indice de lo que ya esta descargado en disco.
 *
 * La ficha de una serie solo sabia si algo se estaba descargando en ESTA
 * sesion (downloadStates vive en memoria), asi que tras reiniciar la app
 * ofrecia "Descargar" sobre ficheros que ya estaban bajados. Ademas, para
 * reproducir hace falta la ruta real en disco, que /api/search no devuelve.
 *
 * Se resuelve consultando /api/files y normalizando los nombres igual que
 * hace el backend en _strip_filename.
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

interface EntradaBiblioteca {
  name: string;
  path: string;
  size?: string;
}

export function useLibrary() {
  const [porNombre, setPorNombre] = useState<Map<string, EntradaBiblioteca>>(new Map());

  const recargar = useCallback(async () => {
    try {
      const res = await apiFetch('/files');
      const data = await res.json();
      const mapa = new Map<string, EntradaBiblioteca>();
      const anadir = (e: any) => {
        if (!e?.name || !e?.path || e.is_dir) return;
        mapa.set(normalizarNombre(e.name), { name: e.name, path: e.path, size: e.size });
      };
      for (const f of data.files || []) {
        anadir(f);
        for (const ep of f.episodes || []) anadir(ep);
      }
      setPorNombre(mapa);
    } catch {}
  }, []);

  useEffect(() => { recargar(); }, [recargar]);

  /** Ruta en disco de un fichero ya descargado, o undefined. */
  const rutaDe = useCallback(
    (nombre?: string) => (nombre ? porNombre.get(normalizarNombre(nombre))?.path : undefined),
    [porNombre],
  );

  return { rutaDe, recargar, total: porNombre.size };
}
