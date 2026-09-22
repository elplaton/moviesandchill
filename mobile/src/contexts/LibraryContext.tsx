import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiFetch } from '../services/api';
import { onProgress } from '../services/ws';
import type { Batch, DownloadState } from '../types';

/**
 * Estado compartido: lo que hay en disco (con dueño), lo que se esta bajando
 * y el progreso por archivo que llega por WebSocket.
 */
export interface LocalFile { name: string; path: string; size?: string; owner: string; canDelete: boolean }

interface Ctx {
  files: LocalFile[];
  batches: Batch[];
  paused: any[];
  states: Map<number, DownloadState>;
  reload: () => Promise<void>;
  localFor: (fileName: string, season?: number | null, episode?: number | null) => LocalFile | undefined;
  download: (msgId: number, channelId?: number) => Promise<string | null>;
  cancel: (batchId: string) => Promise<void>;
  pause: (batchId: string) => Promise<void>;
  resume: (batchId: string) => Promise<void>;
  remove: (path: string) => Promise<string | null>;
}

const LibCtx = createContext<Ctx | null>(null);

const EXT = ['.rar', '.zip', '.7z', '.tar.gz', '.tar.bz2', '.tar', '.tgz', '.tbz2', '.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts'];
const norm = (n: string) => { let s = n.replace(/\.part\d+/i, '').replace(/\.\d{3,}$/, ''); for (const e of EXT) if (s.toLowerCase().endsWith(e)) { s = s.slice(0, -e.length); break; } return s.trim().toLowerCase(); };
const folderOf = (n: string) => {
  let s = n.replace(/\.part\d+/i, '').replace(/\.r\d{2,}$/i, '').replace(/\.\d{3,}$/, '');
  for (const e of EXT) if (s.toLowerCase().endsWith(e)) { s = s.slice(0, -e.length); break; }
  s = s.replace(/[._\s]*(\d{1,2})x\d{1,3}[._\s]*/i, (_m, x) => ` S${parseInt(x)} `).replace(/[._\s]*[sS](\d{1,2})[eE]\d{1,3}[._\s]*/, (_m, x) => ` S${parseInt(x)} `).replace(/[._\s]*[eE]\d{1,3}[._\s]*/, ' ');
  return s.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[<>:"/\\|?*]/g, '').trim().toLowerCase();
};
const epOf = (n: string) => { const m = n.match(/(\d{1,2})x(\d{2,3})|[sS](\d{1,2})[eE](\d{1,3})/); return m ? `${parseInt(m[1] || m[3])}:${parseInt(m[2] || m[4])}` : null; };

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [byName, setByName] = useState<Map<string, LocalFile>>(new Map());
  const [byFolder, setByFolder] = useState<Map<string, LocalFile[]>>(new Map());
  const [batches, setBatches] = useState<Batch[]>([]);
  const [paused, setPaused] = useState<any[]>([]);
  const [states, setStates] = useState<Map<number, DownloadState>>(new Map());

  const loadStatus = useCallback(async () => {
    try {
      const d = await (await apiFetch('/status')).json();
      const list: Batch[] = d.active_batches || [];
      setBatches(list);
      const live = new Set(['downloading', 'extracting', 'converting']);
      setStates(prev => {
        const next = new Map(prev);
        const alive = new Set(list.filter(b => live.has(b.status)).map(b => b.batch_id));
        for (const [k, s] of next) if (s.status !== 'done' && !alive.has(s.batchId)) next.delete(k);
        for (const b of list) {
          if (!live.has(b.status)) continue;
          for (const p of b.parts || []) {
            const cur = next.get(p.message_id);
            if (cur?.status === 'done') continue;
            next.set(p.message_id, { ...cur, messageId: p.message_id, batchId: b.batch_id, progress: p.progress ?? b.progress ?? 0, status: b.status as DownloadState['status'] });
          }
        }
        return next;
      });
    } catch {}
    try { setPaused((await (await apiFetch('/resumable')).json()).batches || []); } catch {}
  }, []);

  const reload = useCallback(async () => {
    try {
      const d = await (await apiFetch('/files')).json();
      const list: LocalFile[] = []; const names = new Map<string, LocalFile>(); const folders = new Map<string, LocalFile[]>();
      const add = (e: any, owner: string, can: boolean) => {
        if (!e?.name || !e?.path || e.is_dir) return;
        const f: LocalFile = { name: e.name, path: e.path, size: e.size, owner, canDelete: can };
        list.push(f); names.set(norm(e.name), f);
        const parts = String(e.path).split('/'); const folder = (parts[parts.length - 2] || '').toLowerCase();
        if (!folders.has(folder)) folders.set(folder, []); folders.get(folder)!.push(f);
      };
      for (const it of d.files || []) { add(it, it.owner || 'admin', !!it.can_delete); for (const ep of it.episodes || []) add(ep, it.owner || 'admin', !!it.can_delete); }
      setFiles(list); setByName(names); setByFolder(folders);
    } catch {}
    await loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    reload();
    return onProgress((d: any) => {
      if (d?.type === 'batch_progress' && d.part_message_id) {
        setStates(prev => { const n = new Map(prev); const cur = n.get(d.part_message_id); if (cur) n.set(d.part_message_id, { ...cur, progress: d.part_progress ?? d.overall_progress ?? cur.progress, downloadedStr: d.downloaded_size_str, totalStr: d.total_size_str }); return n; });
        setBatches(prev => prev.map(b => b.batch_id === d.batch_id ? { ...b, progress: d.overall_progress ?? b.progress } : b));
      }
      if (d?.type === 'batch_status') {
        if (d.status === 'done') reload(); else loadStatus();
      }
    });
  }, [reload, loadStatus]);

  const hayActivas = batches.some(b => ['downloading', 'extracting', 'converting'].includes(b.status));
  useEffect(() => { if (!hayActivas) return; const t = setInterval(loadStatus, 4000); return () => clearInterval(t); }, [hayActivas, loadStatus]);

  const localFor = useCallback((fileName: string, season?: number | null, episode?: number | null) => {
    const exact = byName.get(norm(fileName)); if (exact) return exact;
    const folder = byFolder.get(folderOf(fileName)); if (!folder) return undefined;
    if (episode != null) { const key = `${season ?? ''}:${episode}`; return folder.find(f => epOf(f.name) === key || (season == null && epOf(f.name)?.endsWith(`:${episode}`))); }
    if (folder.length === 1 && !epOf(folder[0].name) && !epOf(fileName)) return folder[0];
    return undefined;
  }, [byName, byFolder]);

  const download = useCallback(async (msgId: number, channelId?: number) => {
    try {
      const d = await (await apiFetch('/download', { method: 'POST', body: JSON.stringify({ message_id: msgId, channel_id: channelId }) })).json();
      if (d.error) return d.error as string;
      setStates(prev => { const n = new Map(prev); for (const p of d.parts || []) n.set(p.message_id, { messageId: p.message_id, batchId: d.batch_id, progress: 0, status: 'downloading' }); return n; });
      loadStatus();
      return null;
    } catch { return 'Sin conexión'; }
  }, [loadStatus]);

  const cancel = useCallback(async (id: string) => { await apiFetch('/cancel', { method: 'POST', body: JSON.stringify({ batch_id: id }) }); loadStatus(); }, [loadStatus]);
  const pause = useCallback(async (id: string) => { await apiFetch('/pause', { method: 'POST', body: JSON.stringify({ batch_id: id }) }); loadStatus(); }, [loadStatus]);
  const resume = useCallback(async (id: string) => { await apiFetch('/resume', { method: 'POST', body: JSON.stringify({ batch_id: id }) }); loadStatus(); }, [loadStatus]);
  const remove = useCallback(async (path: string) => {
    try { const d = await (await apiFetch('/files', { method: 'DELETE', body: JSON.stringify({ path }) })).json(); if (d.error) return d.error as string; await reload(); return null; }
    catch { return 'No se ha podido borrar'; }
  }, [reload]);

  return <LibCtx.Provider value={{ files, batches, paused, states, reload, localFor, download, cancel, pause, resume, remove }}>{children}</LibCtx.Provider>;
}

export function useLibrary(): Ctx { const v = useContext(LibCtx); if (!v) throw new Error('LibraryProvider ausente'); return v; }
