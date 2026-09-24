import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiFetch } from '../services/api';
import { onProgress } from '../services/ws';
import { useAuth } from './AuthContext';

/**
 * Indice de lo que hay en disco, con su dueño.
 *
 * Una descarga la ve todo el mundo, solo la borra quien la hizo (o un admin)
 * y nadie puede volver a bajarla. Las fichas consultan aqui si un archivo ya
 * esta en el servidor para ofrecer Ver / Borrar en vez de Descargar.
 */
export interface LocalFile {
  name: string; path: string; size?: string; owner: string; canDelete: boolean;
  series?: string; season?: number | null; episode?: number | null;
}

interface Ctx {
  /** Sube en cada recarga: quien dependa del disco lo pone en sus dependencias. */
  version: number;
  byName: Map<string, LocalFile>;
  byFolder: Map<string, LocalFile[]>;
  reload: () => Promise<void>;
  localFor: (fileName: string, season?: number | null, episode?: number | null, series?: string) => LocalFile | undefined;
  remove: (path: string) => Promise<string | null>;
}

const LibraryCtx = createContext<Ctx | null>(null);

const EXT = ['.rar', '.zip', '.7z', '.tar.gz', '.tar.bz2', '.tar', '.tgz', '.tbz2', '.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts'];

export function normalizeName(n: string): string {
  let s = n.replace(/\.part\d+/i, '').replace(/\.\d{3,}$/, '');
  for (const e of EXT) if (s.toLowerCase().endsWith(e)) { s = s.slice(0, -e.length); break; }
  return s.trim().toLowerCase();
}

/** Misma regla que suggest_folder_name() del backend. */
export function suggestedFolder(n: string): string {
  let s = n.replace(/\.part\d+/i, '').replace(/\.r\d{2,}$/i, '').replace(/\.\d{3,}$/, '');
  for (const e of EXT) if (s.toLowerCase().endsWith(e)) { s = s.slice(0, -e.length); break; }
  s = s.replace(/[._\s]*(\d{1,2})x\d{1,3}[._\s]*/i, (_m, x) => ` S${parseInt(x)} `);
  s = s.replace(/[._\s]*[sS](\d{1,2})[eE]\d{1,3}[._\s]*/, (_m, x) => ` S${parseInt(x)} `);
  s = s.replace(/[._\s]*[eE]\d{1,3}[._\s]*/, ' ');
  return s.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[<>:"/\\|?*]/g, '').trim().toLowerCase();
}

function episodeOf(n: string): string | null {
  const m = n.match(/(\d{1,2})x(\d{2,3})|[sS](\d{1,2})[eE](\d{1,3})/);
  return m ? `${parseInt(m[1] || m[3])}:${parseInt(m[2] || m[4])}` : null;
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [byName, setByName] = useState<Map<string, LocalFile>>(new Map());
  const [byFolder, setByFolder] = useState<Map<string, LocalFile[]>>(new Map());
  const [byEpisode, setByEpisode] = useState<Map<string, LocalFile>>(new Map());
  const [version, setVersion] = useState(0);

  const reload = useCallback(async () => {
    try {
      const data = await (await apiFetch('/files')).json();
      const names = new Map<string, LocalFile>();
      const folders = new Map<string, LocalFile[]>();
      const eps = new Map<string, LocalFile>();
      const add = (e: any, owner: string, canDelete: boolean, series?: string) => {
        if (!e?.name || !e?.path || e.is_dir) return;
        const f: LocalFile = { name: e.name, path: e.path, size: e.size, owner, canDelete, series, season: e.season ?? null, episode: e.episode ?? null };
        names.set(normalizeName(e.name), f);
        const parts = String(e.path).split('/');
        const folder = (parts[parts.length - 2] || '').toLowerCase();
        if (!folders.has(folder)) folders.set(folder, []);
        folders.get(folder)!.push(f);
        // El archivo en disco se llama "1x01.mp4" y el del mensaje
        // "1x01 - The Office (US).mkv": por nombre no coinciden, por serie y
        // numero de episodio si.
        if (series && e.episode != null) eps.set(`${normalizeName(series)}|${e.season ?? ''}:${e.episode}`, f);
      };
      for (const it of data.files || []) {
        const owner = it.owner || 'admin'; const can = !!it.can_delete;
        add(it, owner, can);
        for (const ep of it.episodes || []) add(ep, ep.owner || owner, ep.can_delete ?? can, it.clean_name || it.name);
      }
      setByName(names); setByFolder(folders); setByEpisode(eps);
      setVersion(v => v + 1);
    } catch {}
  }, []);

  useEffect(() => {
    // Sin sesion no se pide nada: el 401 tiraba el token y recargaba en bucle.
    if (!isAuthenticated) return;
    reload();
    return onProgress((d: any) => { if (d?.type === 'batch_status' && d.status === 'done') reload(); });
  }, [reload, isAuthenticated]);

  const localFor = useCallback((fileName: string, season?: number | null, episode?: number | null, series?: string) => {
    if (series && episode != null) {
      const hit = byEpisode.get(`${normalizeName(series)}|${season ?? ''}:${episode}`)
        || (season == null ? [...byEpisode.entries()].find(([k]) => k.startsWith(`${normalizeName(series)}|`) && k.endsWith(`:${episode}`))?.[1] : undefined);
      if (hit) return hit;
    }
    const exact = byName.get(normalizeName(fileName));
    if (exact) return exact;
    const folder = byFolder.get(suggestedFolder(fileName));
    if (!folder) return undefined;
    if (episode != null) {
      const key = `${season ?? ''}:${episode}`;
      return folder.find(f => episodeOf(f.name) === key || (season == null && episodeOf(f.name)?.endsWith(`:${episode}`)));
    }
    if (folder.length === 1 && !episodeOf(folder[0].name) && !episodeOf(fileName)) return folder[0];
    return undefined;
  }, [byName, byFolder, byEpisode]);

  const remove = useCallback(async (path: string) => {
    try {
      const d = await (await apiFetch('/files', { method: 'DELETE', body: JSON.stringify({ path }) })).json();
      if (d.error) return d.error as string;
      await reload();
      return null;
    } catch { return 'No se ha podido borrar'; }
  }, [reload]);

  return <LibraryCtx.Provider value={{ version, byName, byFolder, reload, localFor, remove }}>{children}</LibraryCtx.Provider>;
}

export function useLibrary(): Ctx {
  const v = useContext(LibraryCtx);
  if (!v) throw new Error('LibraryProvider ausente');
  return v;
}
