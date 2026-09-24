import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useDownloads } from '../hooks/useDownloads';
import { apiFetch } from '../services/api';
import { cleanTitle } from '../utils/text';
import { IconChevronD, IconClose } from './ui/Icon';
import type { IndexChannelStatus } from '../types';

/**
 * Actividad del servidor, abajo a la derecha.
 *
 * Enseña lo que está descargando cualquier cuenta o dispositivo (el móvil y
 * la tele incluidos) y, si eres administrador, el avance del indexado. Solo
 * aparece cuando hay algo que contar y se puede plegar.
 */
export default function ActivityDock() {
  const { isAdmin, username } = useAuth();
  const { batches, downloadStates, pauseBatch, cancelBatch } = useDownloads();
  const [open, setOpen] = useState(true);
  const [channels, setChannels] = useState<IndexChannelStatus[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isAdmin) return;
    const load = () => apiFetch('/index/progress').then(r => r.json()).then(d => setChannels(d.channels || [])).catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [isAdmin]);

  const live = batches.filter(b => ['downloading', 'extracting', 'converting'].includes(b.status) && !hidden.has(b.batch_id));
  const scanning = channels.filter(c => c.status === 'scanning' || c.status === 'running');
  if (!live.length && !scanning.length) return null;

  const total = live.length + scanning.length;

  return (
    <aside className="fixed bottom-6 right-6 z-40 w-[360px] overflow-hidden rounded-panel border border-nf-line bg-nf-surface shadow-panel">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-3 px-4 py-3 hover:bg-white/5">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-nf-ok opacity-70" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-nf-ok" />
        </span>
        <span className="flex-1 text-left text-base font-medium">Actividad ({total})</span>
        <span className={`w-4 h-4 text-nf-faint transition-transform ${open ? '' : 'rotate-180'}`}><IconChevronD /></span>
      </button>

      {open && (
        <div className="max-h-[46vh] overflow-y-auto border-t border-nf-line">
          {live.map(b => {
            const ds = [...downloadStates.values()].find(s => s.batchId === b.batch_id);
            const label = b.status === 'extracting' ? 'Extrayendo' : b.status === 'converting' ? 'Convirtiendo' : `${b.downloaded_parts}/${b.total_parts} partes`;
            const mine = isAdmin || !b.owner || b.owner === username;
            return (
              <div key={b.batch_id} className="border-b border-nf-line px-4 py-3 last:border-0">
                <div className="mb-1.5 flex items-start gap-2">
                  <p className="min-w-0 flex-1 truncate text-base font-medium">{cleanTitle(b.folder_name)}</p>
                  <span className="shrink-0 text-xs text-nf-dim">{b.progress} %</span>
                </div>
                <div className="mb-2 h-1 overflow-hidden rounded-full bg-white/12">
                  <div className="h-full bg-nf-red transition-[width] duration-500" style={{ width: `${b.progress}%` }} />
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-nf-faint">
                  <span className="truncate">
                    {label}{ds?.speed ? ` · ${ds.speed}` : ''}{b.owner && b.owner !== username ? ` · ${b.owner}` : ''}
                  </span>
                  {mine && b.status === 'downloading' && (
                    <span className="flex shrink-0 gap-3">
                      <button onClick={() => pauseBatch(b.batch_id)} className="hover:text-white">Pausar</button>
                      <button onClick={() => cancelBatch(b.batch_id)} className="text-red-400/90 hover:text-red-300">Cancelar</button>
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {scanning.map(c => {
            const pct = c.total_estimate ? Math.round(((c.total_scanned || 0) / c.total_estimate) * 100) : 0;
            return (
              <div key={c.channel_id} className="border-b border-nf-line px-4 py-3 last:border-0">
                <div className="mb-1.5 flex items-start gap-2">
                  <p className="min-w-0 flex-1 truncate text-base">Indexando {c.channel_name}</p>
                  <span className="shrink-0 text-xs text-nf-dim">{pct} %</span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-white/12">
                  <div className="h-full bg-nf-warn transition-[width] duration-500" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
