import { useState, useEffect } from 'react';
import type { Batch, DownloadState, IndexChannelStatus } from '../types';

interface DownloadBarProps {
  batches: Batch[];
  onPause: (id: string) => void;
  onCancel: (id: string) => void;
  downloadStates?: Map<number, DownloadState>;
  indexChannels?: IndexChannelStatus[];
}

export default function DownloadBar({ batches, onPause, onCancel, downloadStates, indexChannels }: DownloadBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [dismissedBatches, setDismissedBatches] = useState<Set<string>>(new Set());
  const [dismissedChannels, setDismissedChannels] = useState<Set<number>>(new Set());

  useEffect(() => {
    setDismissedBatches(new Set());
    setDismissedChannels(new Set());
  }, []);

  const dismissBatch = (id: string) => {
    setDismissedBatches(prev => new Set([...prev, id]));
  };

  const dismissChannel = (channelId: number) => {
    setDismissedChannels(prev => new Set([...prev, channelId]));
  };

  const visibleBatches = batches.filter(b => !dismissedBatches.has(b.batch_id));
  const visibleIndexChannels = (indexChannels || []).filter(
    c => !dismissedChannels.has(c.channel_id) && (c.status === 'done' || c.status === 'scanning' || c.status === 'running' || c.status === 'pending')
  );

  const hasContent = visibleBatches.length > 0 || visibleIndexChannels.length > 0;
  if (!hasContent) return null;

  const totalItems = visibleBatches.length + visibleIndexChannels.length;

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
          Actividad ({totalItems})
        </span>
        <svg className={`w-4 h-4 text-gray-400 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      </button>

      {expanded && (
        <div className="bg-netflix-dark/95 backdrop-blur-xl border-x border-b border-white/10 rounded-b-2xl max-h-80 overflow-y-auto shadow-2xl shadow-black/40 animate-scale-in">
          {/* Index progress */}
          {visibleIndexChannels.map(ch => {
            const pct = (ch.total_estimate || 0) > 0
              ? Math.round(((ch.total_scanned || 0) / (ch.total_estimate || 1)) * 100)
              : 0;
            const isScanning = ch.status === 'running' || ch.status === 'scanning';
            return (
              <div key={`idx-${ch.channel_id}`} className="px-5 py-3 border-b border-white/5 last:border-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-white text-xs truncate flex-1 mr-2 font-medium">{ch.channel_name}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-gray-400 text-[10px]">
                      {isScanning ? `${pct}%` : ch.status === 'done' ? 'Indexado' : 'Pendiente'}
                    </span>
                    {(ch.status === 'done' || ch.status === 'pending') && (
                      <button onClick={() => dismissChannel(ch.channel_id)} className="text-gray-500 hover:text-white text-xs leading-none ml-1" title="Ocultar">✕</button>
                    )}
                  </div>
                </div>
                {(ch.total_estimate || 0) > 0 && (
                  <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden mb-1.5">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${pct}%`,
                        background: ch.status === 'done' ? '#2ECC40' : '#E50914',
                      }}
                    />
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-gray-500 text-[10px]">
                    {(ch.total_scanned || 0).toLocaleString()} / {(ch.total_estimate || 0).toLocaleString()} msgs
                    {(ch.total_indexed || 0) > 0 && ` · ${(ch.total_indexed || 0).toLocaleString()} media`}
                  </span>
                </div>
              </div>
            );
          })}

          {/* Downloads */}
          {visibleBatches.map(b => {
            const batchDs: DownloadState[] = [];
            if (downloadStates) {
              for (const [, ds] of downloadStates) {
                if (ds.batchId === b.batch_id) batchDs.push(ds);
              }
            }
            const speed = batchDs.find(d => d.speed)?.speed || '';
            const dsFirst = batchDs[0];
            const isDone = b.status === 'done';
            const isCancelled = b.status === 'cancelled';

            return (
            <div key={b.batch_id} className="px-5 py-3 border-b border-white/5 last:border-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-white text-xs truncate flex-1 mr-2 font-medium">{b.folder_name}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-gray-400 text-[10px]">
                    {isCancelled ? 'Cancelada'
                      : b.status === 'extracting' ? 'Extrayendo...'
                      : b.status === 'converting' ? 'Convirtiendo...'
                      : isDone ? 'Completada'
                      : `${b.progress}%`}
                  </span>
                  {(isDone || isCancelled) && (
                    <button onClick={() => dismissBatch(b.batch_id)} className="text-gray-500 hover:text-white text-xs leading-none ml-1" title="Ocultar">✕</button>
                  )}
                </div>
              </div>
              <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden mb-1.5">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${isDone ? 100 : isCancelled ? 0 : b.progress}%`,
                    background: isCancelled ? '#E50914'
                      : b.status === 'extracting' || b.status === 'converting' ? 'linear-gradient(90deg, #E50914, #F5A623)'
                      : isDone ? '#2ECC40'
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
