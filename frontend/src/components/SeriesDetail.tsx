import { useEffect, useState, useMemo } from 'react';
import DownloadRing, { type RingStatus } from './DownloadRing';
import { cleanFileName } from './MovieCard';
import type { FileItem, TMDBMetadata, SeriesEpisode, DownloadState } from '../types';

const MULTIPART_RE = /^(.+?)(?:\.part(\d+))?\.(?:rar|r(\d{2,})|(\d{3,})|zip\.(\d{3,})|7z\.(\d{3,})|z(\d{2,}))$/i;

interface EpGroup {
  baseName: string;
  episodes: SeriesEpisode[];
  first: SeriesEpisode;
  isMultipart: boolean;
  totalSize: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  for (let i = 0; i < u.length; i++) {
    if (v < 1024) return `${v.toFixed(1)} ${u[i]}`;
    v /= 1024;
  }
  return `${v.toFixed(1)} PB`;
}

function EpisodeRow({ ep, streamUrl, onDownload, onCancelDownload, downloadStates }: {
  ep: SeriesEpisode;
  streamUrl: (path: string) => string;
  onDownload?: (msgId: number, channelId?: number) => void;
  onCancelDownload?: (batchId: string) => void;
  downloadStates?: Map<number, DownloadState>;
}) {
  const epMatch = ep.name.match(/(\d{1,2})x(\d{2})/i);
  const ds = ep.message_id ? downloadStates?.get(ep.message_id) : undefined;

  return (
    <div className="flex items-center gap-3 bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 hover:bg-white/[0.06] transition-all group/ep">
      <span className="text-gray-400 text-xs w-12 shrink-0 text-right font-mono tabular-nums">
        {epMatch ? `${epMatch[1]}x${epMatch[2]}` : '-'}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm truncate">{cleanFileName(ep.name)}</p>
        <p className="text-gray-500 text-[11px]">{ep.size}</p>
      </div>
      {ep.path ? (
        <a href={streamUrl(ep.path)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
          className="bg-white/10 hover:bg-white/20 text-white rounded-full p-2 transition-all hover:scale-110 shrink-0">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </a>
      ) : ds && ds.status !== 'done' && ds.status !== 'error' ? (
        <div className="flex items-center gap-1.5 shrink-0">
          <DownloadRing progress={ds.progress} status={ds.status as RingStatus}
            onCancel={onCancelDownload ? () => onCancelDownload(ds.batchId) : undefined} size={28}
            downloadedStr={ds.downloadedStr} totalStr={ds.totalStr} speed={ds.speed} />
          <span className="text-white/60 text-[10px]">{ds.progress}%</span>
        </div>
      ) : onDownload && ep.message_id ? (
        <button onClick={(e) => { e.stopPropagation(); onDownload(ep.message_id!, ep.channel_id); }}
          className="bg-netflix-red hover:bg-netflix-red-hover text-white text-xs px-3 py-1.5 rounded-lg transition-all hover:scale-105 font-medium shrink-0">
          Descargar
        </button>
      ) : null}
    </div>
  );
}

interface SeriesDetailProps {
  series: FileItem;
  metadata: TMDBMetadata;
  onClose: () => void;
  streamUrl: (path: string) => string;
  onDownload?: (msgId: number, channelId?: number) => void;
  onCancelDownload?: (batchId: string) => void;
  downloadStates?: Map<number, DownloadState>;
}

export default function SeriesDetail({ series, metadata, onClose, streamUrl, onDownload, onCancelDownload, downloadStates }: SeriesDetailProps) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const seasons = useMemo(() => {
    const map = new Map<number, SeriesEpisode[]>();
    for (const ep of series.episodes || []) {
      const m = ep.name.match(/(\d{1,2})x(\d{2})/i);
      const season = m ? parseInt(m[1]) : 1;
      if (!map.has(season)) map.set(season, []);
      map.get(season)!.push(ep);
    }
    const result: [number, EpGroup[]][] = [];
    for (const [season, eps] of Array.from(map.entries()).sort(([a], [b]) => a - b)) {
      const mpMap = new Map<string, SeriesEpisode[]>();
      const mpSingles: SeriesEpisode[] = [];
      for (const ep of eps) {
        const m = ep.name.match(MULTIPART_RE);
        if (m) {
          const base = m[1].replace(/\.$/, '').trim().toLowerCase();
          if (!mpMap.has(base)) mpMap.set(base, []);
          mpMap.get(base)!.push(ep);
        } else {
          mpSingles.push(ep);
        }
      }
      const epGroups: EpGroup[] = [];
      for (const [, parts] of mpMap) {
        parts.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        epGroups.push({
          baseName: parts[0].name.replace(/\.\d{2,}$/, '').replace(/\.part\d+\.rar$/i, ''),
          episodes: parts,
          first: parts[0],
          isMultipart: true,
          totalSize: parts.reduce((s, p) => s + parseInt(p.size.replace(/[^\d.]/g, '')) * 1e9, 0),
        });
      }
      for (const ep of mpSingles) {
        epGroups.push({ baseName: ep.name, episodes: [ep], first: ep, isMultipart: false, totalSize: 0 });
      }
      result.push([season, epGroups]);
    }
    return result;
  }, [series.episodes]);

  const toggleSeason = (s: number) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />

      <div
        className="relative bg-netflix-dark border border-white/10 rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-hidden shadow-2xl shadow-black/50 animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-20 w-8 h-8 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/10 transition-colors"
        >
          ✕
        </button>

        <div className="relative h-56 md:h-72 overflow-hidden">
          {metadata.backdrop ? (
            <img src={metadata.backdrop} alt="" className="w-full h-full object-cover" />
          ) : metadata.poster ? (
            <img src={metadata.poster} alt="" className="w-full h-full object-cover scale-110 blur-sm opacity-60" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-netflix-red/40 via-netflix-dark to-netflix-darker" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-netflix-dark via-netflix-dark/40 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-netflix-dark/70 to-transparent" />

          <div className="absolute bottom-0 left-0 right-0 p-6 md:p-8">
            <h1 className="text-white text-2xl md:text-3xl font-bold drop-shadow-lg tracking-tight">
              {metadata.title || series.name}
            </h1>
            <div className="flex items-center gap-3 mt-2">
              {metadata.year && <span className="text-gray-300 text-sm">{metadata.year}</span>}
              {metadata.rating && (
                <span className="text-yellow-400 text-sm flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  {metadata.rating.toFixed(1)}
                </span>
              )}
              <span className="text-gray-400 text-sm">{series.episodes?.length || 0} episodios</span>
            </div>
            {metadata.overview && (
              <p className="text-gray-300 text-sm mt-3 line-clamp-3 max-w-xl leading-relaxed">{metadata.overview}</p>
            )}
          </div>
        </div>

        <div className="p-5 md:p-6 overflow-y-auto max-h-[50vh]">
          {seasons.length > 1 ? (
            seasons.map(([seasonNum, epGroups]) => (
              <div key={seasonNum} className="mb-3">
                <button
                  onClick={() => toggleSeason(seasonNum)}
                  className="w-full flex items-center gap-2 text-white font-semibold text-sm mb-2 hover:bg-white/5 rounded-lg px-2 py-1.5 transition-colors"
                >
                  <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${collapsed.has(seasonNum) ? '' : 'rotate-90'}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
                  Temporada {seasonNum}
                  <span className="text-gray-500 text-xs font-normal ml-1">({epGroups.length} episodios)</span>
                </button>
                {!collapsed.has(seasonNum) && (
                  <div className="space-y-1.5 ml-4">
                    {epGroups.map(g => (
                      g.isMultipart ? (
                        <div key={g.first.message_id}
                          className="flex items-center gap-3 bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 hover:bg-white/[0.06] transition-all group/ep">
                          <span className="text-gray-400 text-xs w-12 shrink-0 text-right font-mono tabular-nums">
                            {g.first.name.match(/(\d{1,2})x(\d{2})/i)?.[0] || '-'}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm truncate">{cleanFileName(g.baseName)}</p>
                            <p className="text-gray-500 text-[11px]">{g.episodes.length} partes · {g.episodes[0].size}</p>
                          </div>
                          {g.first.path ? (
                            <a href={streamUrl(g.first.path)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                              className="bg-white/10 hover:bg-white/20 text-white rounded-full p-2 transition-all hover:scale-110 shrink-0">
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                            </a>
                          ) : onDownload && g.first.message_id ? (
                            (() => {
                              const ds = g.first.message_id ? downloadStates?.get(g.first.message_id) : undefined;
                              if (ds && ds.status !== 'done' && ds.status !== 'error') {
                                return (
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <DownloadRing progress={ds.progress} status={ds.status as RingStatus}
                                      onCancel={onCancelDownload ? () => onCancelDownload(ds.batchId) : undefined} size={28}
                                      downloadedStr={ds.downloadedStr} totalStr={ds.totalStr} speed={ds.speed} />
                                    <span className="text-white/60 text-[10px]">{ds.progress}%</span>
                                  </div>
                                );
                              }
                              return (
                                <button onClick={(e) => { e.stopPropagation(); onDownload(g.first.message_id!, g.first.channel_id); }}
                                  className="bg-netflix-red hover:bg-netflix-red-hover text-white text-xs px-3 py-1.5 rounded-lg transition-all hover:scale-105 font-medium shrink-0">
                                  Descargar ({g.episodes.length})
                                </button>
                              );
                            })()
                          ) : null}
                        </div>
                      ) : (
                        <EpisodeRow key={g.first.path || `${g.first.message_id}-${epGroups.indexOf(g)}`} ep={g.first} streamUrl={streamUrl}
                          onDownload={onDownload} onCancelDownload={onCancelDownload} downloadStates={downloadStates} />
                      )
                    ))}
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="space-y-2">
              {(seasons[0]?.[1] || []).map(g => (
                g.isMultipart ? (
                  <div key={g.first.message_id}
                    className="flex items-center gap-3 bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 hover:bg-white/[0.06] transition-all group/ep">
                    <span className="text-gray-400 text-xs w-12 shrink-0 text-right font-mono tabular-nums">-</span>
                    <div className="flex-1 min-w-0">
                        <p className="text-white text-sm truncate">{cleanFileName(g.baseName)}</p>
                      <p className="text-gray-500 text-[11px]">{g.episodes.length} partes · {g.episodes[0].size}</p>
                    </div>
                    {g.first.path ? (
                      <a href={streamUrl(g.first.path)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                        className="bg-white/10 hover:bg-white/20 text-white rounded-full p-2 transition-all hover:scale-110 shrink-0">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                      </a>
                    ) : onDownload && g.first.message_id ? (
                      (() => {
                        const ds = g.first.message_id ? downloadStates?.get(g.first.message_id) : undefined;
                        if (ds && ds.status !== 'done' && ds.status !== 'error') {
                          return (
                             <div className="flex items-center gap-2 shrink-0">
                               <DownloadRing progress={ds.progress} status={ds.status as RingStatus}
                                 onCancel={onCancelDownload ? () => onCancelDownload(ds.batchId) : undefined} size={28}
                                 downloadedStr={ds.downloadedStr} totalStr={ds.totalStr} speed={ds.speed} />
                               <span className="text-white/60 text-[10px]">{ds.progress}%</span>
                             </div>
                           );
                         }
                         return (
                           <button onClick={(e) => { e.stopPropagation(); onDownload(g.first.message_id!, g.first.channel_id); }}
                            className="bg-netflix-red hover:bg-netflix-red-hover text-white text-xs px-3 py-1.5 rounded-lg transition-all hover:scale-105 font-medium shrink-0">
                            Descargar ({g.episodes.length})
                          </button>
                        );
                      })()
                    ) : null}
                  </div>
                ) : (
                  <EpisodeRow key={g.first.path || `${g.first.message_id}-${(seasons[0]?.[1] || []).indexOf(g)}`} ep={g.first} streamUrl={streamUrl}
                    onDownload={onDownload} onCancelDownload={onCancelDownload} downloadStates={downloadStates} />
                )
              ))}
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white text-sm px-4 py-2 rounded-xl hover:bg-white/5 transition-all"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
