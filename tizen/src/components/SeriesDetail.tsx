import { useEffect, useState, useMemo } from 'react';
import DownloadRing, { type RingStatus } from './DownloadRing';
import { cleanFileName } from '../utils/text';
import { formatBytes } from '../utils/format';
import { MULTIPART as MULTIPART_RE } from '../utils/regex';
import { apiFetch } from '../services/api';
import type { FileItem, TMDBMetadata, SeriesEpisode, DownloadState } from '../types';

function parseEpisode(filename: string): { season: number; episode: number; label: string } | null {
  let m = filename.match(/(\d{1,2})x(\d{2})/i);
  if (m) return { season: parseInt(m[1]), episode: parseInt(m[2]), label: `${m[1]}x${m[2]}` };
  m = filename.match(/[sS](\d{2})[eE](\d{2})/);
  if (m) return { season: parseInt(m[1]), episode: parseInt(m[2]), label: `${parseInt(m[1])}x${parseInt(m[2])}` };
  m = filename.match(/\[[Ss]\s*(\d{1,2})\s*[Ee]\s*(\d{1,2})\]/);
  if (m) return { season: parseInt(m[1]), episode: parseInt(m[2]), label: `${m[1]}x${m[2]}` };
  return null;
}

const QUALITY_TAGS = ['2160p','1080p','720p','4K','4k','x264','x265','HEVC','HDR','DV','DoVi','WEB','BluRay','BDRip','REMUX','HDR10','HDR10+','AV1'];

function extractQuality(filename: string): string {
  const found: string[] = [];
  for (const tag of QUALITY_TAGS) {
    if (new RegExp(`\\b${tag}\\b`, 'i').test(filename) && !found.some(f => f.toLowerCase() === tag.toLowerCase())) {
      found.push(tag);
    }
  }
  return found.join(' · ') || '';
}

interface EpGroup {
  baseName: string;
  episodes: SeriesEpisode[];
  first: SeriesEpisode;
  isMultipart: boolean;
  totalSize: number;
  variants?: EpGroup[];
}

function EpisodeRow({ ep, streamUrl, onDownload, onCancelDownload, downloadStates, tmdbName }: {
  ep: SeriesEpisode;
  streamUrl: (path: string) => string;
  onDownload?: (msgId: number, channelId?: number) => void;
  onCancelDownload?: (batchId: string) => void;
  downloadStates?: Map<number, DownloadState>;
  tmdbName?: string;
}) {
  const parsed = parseEpisode(ep.name);
  const ds = ep.message_id ? downloadStates?.get(ep.message_id) : undefined;
  const displayName = tmdbName || cleanFileName(ep.name);

  return (
    <div className="flex items-center gap-3 bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 hover:bg-white/[0.06] transition-all group/ep">
      <span className="text-gray-400 text-xs w-12 shrink-0 text-right font-mono tabular-nums">
        {parsed ? parsed.label : '-'}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm truncate">{displayName}</p>
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
      ) : ep.message_id ? (
        <button onClick={(e) => { e.stopPropagation(); onDownload ? onDownload(ep.message_id!, ep.channel_id) : null; }}
          className="bg-netflix-red hover:bg-netflix-red-hover text-white text-xs px-3 py-1.5 rounded-lg transition-all hover:scale-105 font-medium shrink-0">
          Descargar
        </button>
      ) : (
        <span className="text-gray-600 text-[10px] shrink-0">No disponible</span>
      )}
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
  tmdbId?: number;
}

export default function SeriesDetail({ series, metadata, onClose, streamUrl, onDownload, onCancelDownload, downloadStates, tmdbId }: SeriesDetailProps) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [expandedVariants, setExpandedVariants] = useState<Set<string>>(new Set());
  const [episodeNames, setEpisodeNames] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    if (!tmdbId) return;
    const seasons = new Set<number>();
    for (const ep of series.episodes || []) {
      const parsed = parseEpisode(ep.name);
      if (parsed) seasons.add(parsed.season);
    }
    const fetchAll = async () => {
      const names = new Map<number, string>();
      for (const s of seasons) {
        try {
          const res = await apiFetch(`/tmdb/season?tmdb_id=${tmdbId}&season=${s}`);
          const data = await res.json();
          for (const ep of data.episodes || []) {
            const key = s * 1000 + ep.episode_number;
            if (ep.name) names.set(key, ep.name);
          }
        } catch {}
      }
      setEpisodeNames(names);
    };
    fetchAll();
  }, [tmdbId, series.episodes]);

  const getEpisodeName = (epName: string): string | undefined => {
    const parsed = parseEpisode(epName);
    if (!parsed) return undefined;
    const key = parsed.season * 1000 + parsed.episode;
    return episodeNames.get(key);
  };

  const seasons = useMemo(() => {
    const map = new Map<number, SeriesEpisode[]>();
    for (const ep of series.episodes || []) {
      const parsed = parseEpisode(ep.name);
      const season = parsed ? parsed.season : 1;
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
      epGroups.sort((a, b) => a.baseName.localeCompare(b.baseName, undefined, { numeric: true }));

      const merged: EpGroup[] = [];
      const used = new Set<number>();
      for (let i = 0; i < epGroups.length; i++) {
        if (used.has(i)) continue;
        const g = epGroups[i];
        const parsed = parseEpisode(g.first.name);
        if (!parsed) {
          merged.push(g);
          continue;
        }
        const siblings = [g];
        for (let j = i + 1; j < epGroups.length; j++) {
          if (used.has(j)) continue;
          const other = epGroups[j];
          const otherParsed = parseEpisode(other.first.name);
          if (otherParsed && otherParsed.season === parsed.season && otherParsed.episode === parsed.episode) {
            siblings.push(other);
            used.add(j);
          }
        }
        if (siblings.length > 1) {
          const tmdbNamed = siblings.find(s => getEpisodeName(s.first.name));
          const bestName = tmdbNamed ? getEpisodeName(tmdbNamed.first.name) || cleanFileName(tmdbNamed.first.name) : cleanFileName(g.first.name);
          const allEps = siblings.flatMap(s => s.episodes);
          merged.push({
            baseName: bestName || g.baseName,
            episodes: allEps,
            first: g.first,
            isMultipart: siblings.some(s => s.isMultipart),
            totalSize: 0,
            variants: siblings,
          });
        } else {
          merged.push(g);
        }
        used.add(i);
      }
      result.push([season, merged]);
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

  const toggleVariant = (key: string) => {
    setExpandedVariants(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
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
                    {epGroups.map(g => {
                      const label = parseEpisode(g.first.name)?.label || '-';
                      const parsed = parseEpisode(g.first.name);
                      const vKey = parsed ? `${parsed.season}x${parsed.episode}` : '';

                      // Non-merged: single variant
                      if (!g.variants || g.variants.length <= 1) {
                        const quality = extractQuality(g.first.name);
                        const info = g.isMultipart
                          ? `${g.episodes.length} partes · ${g.episodes[0].size}`
                          : g.episodes[0].size;
                        return (
                          <div key={g.first.message_id || g.baseName}
                            className="flex items-center gap-3 bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 hover:bg-white/[0.06] transition-all group/ep">
                            <span className="text-gray-400 text-xs w-12 shrink-0 text-right font-mono tabular-nums">{label}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-white text-sm truncate">{cleanFileName(g.baseName)}</p>
                              <p className="text-gray-500 text-[11px]">{quality ? `${quality} · ` : ''}{info}</p>
                            </div>
                            {g.first.message_id ? (
                              <button onClick={(e) => { e.stopPropagation(); onDownload ? onDownload(g.first.message_id!, g.first.channel_id) : null; }}
                                className="bg-netflix-red hover:bg-netflix-red-hover text-white text-xs px-3 py-1.5 rounded-lg transition-all hover:scale-105 font-medium shrink-0">
                                Descargar{g.isMultipart ? ` (${g.episodes.length})` : ''}
                              </button>
                            ) : (
                              <span className="text-gray-600 text-[10px] shrink-0">No disponible</span>
                            )}
                          </div>
                        );
                      }

                      // Merged: multiple variants, collapsible
                      const tmdbName = getEpisodeName(g.first.name);
                      const displayName = tmdbName || cleanFileName(g.baseName);
                      const isExpanded = expandedVariants.has(vKey);
                      return (
                        <div key={vKey}>
                          <button onClick={() => toggleVariant(vKey)}
                            className="flex items-center gap-3 bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 hover:bg-white/[0.06] transition-all w-full text-left group/ep">
                            <span className="text-gray-400 text-xs w-12 shrink-0 text-right font-mono tabular-nums">{label}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-white text-sm truncate">{displayName}</p>
                              <p className="text-gray-500 text-[11px]">{g.variants.length} versiones</p>
                            </div>
                            <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                              fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                          {isExpanded && (
                            <div className="ml-6 mt-1 space-y-1">
                              {g.variants.map(v => {
                                const quality = extractQuality(v.first.name);
                                const info = v.isMultipart
                                  ? `${v.episodes.length} partes · ${v.episodes[0].size}`
                                  : v.episodes[0].size;
                                return (
                                  <div key={v.first.message_id}
                                    className="flex items-center gap-3 bg-white/[0.02] border border-white/5 rounded-lg px-3 py-2 hover:bg-white/[0.04] transition-all">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-gray-300 text-xs truncate">{quality || cleanFileName(v.first.name)}</p>
                                      <p className="text-gray-500 text-[10px]">{info}</p>
                                    </div>
                                    {v.first.message_id ? (
                                      <button onClick={(e) => { e.stopPropagation(); onDownload ? onDownload(v.first.message_id!, v.first.channel_id) : null; }}
                                        className="bg-netflix-red hover:bg-netflix-red-hover text-white text-xs px-2.5 py-1 rounded-lg transition-all hover:scale-105 font-medium shrink-0">
                                        Descargar{v.isMultipart ? ` (${v.episodes.length})` : ''}
                                      </button>
                                    ) : (
                                      <span className="text-gray-600 text-[10px] shrink-0">No disponible</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="space-y-2">
              {(seasons[0]?.[1] || []).map(g => {
                const label = parseEpisode(g.first.name)?.label || '-';
                const parsed = parseEpisode(g.first.name);
                const vKey = parsed ? `${parsed.season}x${parsed.episode}` : '';

                if (!g.variants || g.variants.length <= 1) {
                  const quality = extractQuality(g.first.name);
                  const info = g.isMultipart
                    ? `${g.episodes.length} partes · ${g.episodes[0].size}`
                    : g.episodes[0].size;
                  return (
                    <div key={g.first.message_id || g.baseName}
                      className="flex items-center gap-3 bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 hover:bg-white/[0.06] transition-all group/ep">
                      <span className="text-gray-400 text-xs w-12 shrink-0 text-right font-mono tabular-nums">{label}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm truncate">{cleanFileName(g.baseName)}</p>
                        <p className="text-gray-500 text-[11px]">{quality ? `${quality} · ` : ''}{info}</p>
                      </div>
                      {g.first.message_id ? (
                        <button onClick={(e) => { e.stopPropagation(); onDownload ? onDownload(g.first.message_id!, g.first.channel_id) : null; }}
                          className="bg-netflix-red hover:bg-netflix-red-hover text-white text-xs px-3 py-1.5 rounded-lg transition-all hover:scale-105 font-medium shrink-0">
                          Descargar{g.isMultipart ? ` (${g.episodes.length})` : ''}
                        </button>
                      ) : (
                        <span className="text-gray-600 text-[10px] shrink-0">No disponible</span>
                      )}
                    </div>
                  );
                }

                const tmdbName = getEpisodeName(g.first.name);
                const displayName = tmdbName || cleanFileName(g.baseName);
                const isExpanded = expandedVariants.has(vKey);
                return (
                  <div key={vKey}>
                    <button onClick={() => toggleVariant(vKey)}
                      className="flex items-center gap-3 bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 hover:bg-white/[0.06] transition-all w-full text-left group/ep">
                      <span className="text-gray-400 text-xs w-12 shrink-0 text-right font-mono tabular-nums">{label}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm truncate">{displayName}</p>
                        <p className="text-gray-500 text-[11px]">{g.variants.length} versiones</p>
                      </div>
                      <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                    {isExpanded && (
                      <div className="ml-6 mt-1 space-y-1">
                        {g.variants.map(v => {
                          const quality = extractQuality(v.first.name);
                          const info = v.isMultipart
                            ? `${v.episodes.length} partes · ${v.episodes[0].size}`
                            : v.episodes[0].size;
                          return (
                            <div key={v.first.message_id}
                              className="flex items-center gap-3 bg-white/[0.02] border border-white/5 rounded-lg px-3 py-2 hover:bg-white/[0.04] transition-all">
                              <div className="flex-1 min-w-0">
                                <p className="text-gray-300 text-xs truncate">{quality || cleanFileName(v.first.name)}</p>
                                <p className="text-gray-500 text-[10px]">{info}</p>
                              </div>
                              {v.first.message_id ? (
                                <button onClick={(e) => { e.stopPropagation(); onDownload ? onDownload(v.first.message_id!, v.first.channel_id) : null; }}
                                  className="bg-netflix-red hover:bg-netflix-red-hover text-white text-xs px-2.5 py-1 rounded-lg transition-all hover:scale-105 font-medium shrink-0">
                                  Descargar{v.isMultipart ? ` (${v.episodes.length})` : ''}
                                </button>
                              ) : (
                                <span className="text-gray-600 text-[10px] shrink-0">No disponible</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
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
