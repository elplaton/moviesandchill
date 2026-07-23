import { useState } from 'react';
import type { Batch, DownloadState } from '../types';

interface DownloadBarProps {
  batches: Batch[];
  onPause: (id: string) => void;
  onCancel: (id: string) => void;
  downloadStates?: Map<number, DownloadState>;
}

export default function DownloadBar({ batches, onPause, onCancel, downloadStates }: DownloadBarProps) {
  const [expanded, setExpanded] = useState(false);

  if (batches.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full bg-netflix-dark/90 backdrop-blur-xl border border-white/10 rounded-2xl px-5 py-3 flex items-center justify-between hover:bg-netflix-card/90 transition-all shadow-2xl shadow-black/40"
      >
        <span className="text-sm text-white font-medium flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-green-400" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
          Descargas ({batches.length})
        </span>
        <svg className={`w-4 h-4 text-gray-400 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      </button>

      {expanded && (
        <div className="bg-netflix-dark/95 backdrop-blur-xl border-x border-b border-white/10 rounded-b-2xl max-h-72 overflow-y-auto shadow-2xl shadow-black/40 animate-scale-in">
          {batches.map(b => {
            const batchDs: DownloadState[] = [];
            if (downloadStates) {
              for (const [, ds] of downloadStates) {
                if (ds.batchId === b.batch_id) batchDs.push(ds);
              }
            }
            const speed = batchDs.find(d => d.speed)?.speed || '';
            const dsFirst = batchDs[0];

            return (
            <div key={b.batch_id} className="px-5 py-3 border-b border-white/5 last:border-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-white text-xs truncate flex-1 mr-2 font-medium">{b.folder_name}</span>
                <span className="text-gray-400 text-[10px] shrink-0 ml-2">
                  {b.status === 'cancelled' ? 'Cancelada'
                    : b.status === 'extracting' ? 'Extrayendo...'
                    : b.status === 'converting' ? 'Convirtiendo...'
                    : b.status === 'done' ? 'Completada'
                    : `${b.progress}%`}
                </span>
              </div>
              <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden mb-1.5">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${b.status === 'done' ? 100 : b.status === 'cancelled' ? 0 : b.progress}%`,
                    background: b.status === 'cancelled' ? '#E50914'
                      : b.status === 'extracting' || b.status === 'converting' ? 'linear-gradient(90deg, #E50914, #F5A623)'
                      : b.status === 'done' ? '#2ECC40'
                      : '#E50914',
                  }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 text-[10px]">
                  {speed && <span className="text-green-400">{speed}</span>}
                  {speed && dsFirst?.downloadedStr && <span> &middot; </span>}
                  {dsFirst?.downloadedStr && dsFirst.totalStr
                    ? `${dsFirst.downloadedStr} / ${dsFirst.totalStr}`
                    : b.total_size_str || `${b.downloaded_parts}/${b.total_parts} partes`}
                </span>
                <div className="flex gap-3">
                  {b.status === 'downloading' && (
                    <>
                      <button onClick={() => onPause(b.batch_id)} className="text-gray-400 hover:text-white text-[11px] transition-colors font-medium">
                        Pausar
                      </button>
                      <button onClick={() => onCancel(b.batch_id)} className="text-red-400/80 hover:text-red-300 text-[11px] transition-colors font-medium">
                        Cancelar
                      </button>
                    </>
                  )}
                  {b.status === 'cancelled' && (
                    <span className="text-red-400/60 text-[10px]">Descarga cancelada</span>
                  )}
                  <span className="text-gray-500 text-[10px]">{b.downloaded_parts}/{b.total_parts}</span>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
