import { useEffect, useState, useMemo } from 'react';
import DownloadRing, { type RingStatus } from './DownloadRing';
import { cleanFileName } from '../utils/text';
import { formatBytes } from '../utils/format';
import { RES_TAGS, MULTIPART } from '../utils/regex';
import type { TMDBMetadata, SearchResult, DownloadState } from '../types';

interface MovieDetailProps {
  title: string;
  metadata: TMDBMetadata;
  results: SearchResult[];
  onClose: () => void;
  onDownload: (msgId: number, channelId?: number) => void;
  onCancelDownload?: (batchId: string) => void;
  downloadStates?: Map<number, DownloadState>;
}

interface MultipartGroup {
  baseName: string;
  parts: SearchResult[];
  firstId: number;
  channelId?: number;
  totalSize: number;
}

function groupMultiparts(items: SearchResult[]): { groups: MultipartGroup[]; singles: SearchResult[] } {
  const map = new Map<string, SearchResult[]>();
  const singles: SearchResult[] = [];

  for (const r of items) {
    const m = r.file_name.match(MULTIPART);
    if (m) {
      const base = m[1].replace(/\.$/, '').trim();
      const key = base.toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    } else {
      singles.push(r);
    }
  }

  const groups: MultipartGroup[] = [];
  for (const [, parts] of map) {
    parts.sort((a, b) => a.file_name.localeCompare(b.file_name, undefined, { numeric: true }));
    groups.push({
      baseName: parts[0].file_name.replace(/\.\d{2,}$/, '').replace(/\.part\d+\.rar$/i, '').replace(/\.zip\.\d{3,}$/i, '').replace(/\.7z\.\d{3,}$/i, ''),
      parts,
      firstId: parts[0].id,
      channelId: parts[0].channel_id,
      totalSize: parts.reduce((s, p) => s + p.size, 0),
    });
  }

  return { groups, singles };
}

function extractRes(name: string): string {
  const tags: string[] = [];
  const seen = new Set<string>();
  let m;
  const regex = new RegExp(RES_TAGS.source, 'gi');
  while ((m = regex.exec(name)) !== null) {
    const tag = m[1].toUpperCase();
    if (!seen.has(tag)) { seen.add(tag); tags.push(tag); }
  }
  return tags.join(' ') || 'HD';
}

export default function MovieDetail({ title, metadata, results, onClose, onDownload, onCancelDownload, downloadStates }: MovieDetailProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    for (const r of results) {
      const res = extractRes(r.file_name);
      if (!map.has(res)) map.set(res, []);
      map.get(res)!.push(r);
    }
    const result: { res: string; items: SearchResult[]; mpGroups: MultipartGroup[]; mpSingles: SearchResult[] }[] = [];
    for (const [res, items] of map.entries()) {
      const { groups: mpGroups, singles: mpSingles } = groupMultiparts(items);
      result.push({ res, items, mpGroups, mpSingles });
    }
    return result;
  }, [results]);

  const toggleRes = (res: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(res)) next.delete(res);
      else next.add(res);
      return next;
    });
  };

  const downloadBtn = (msgId: number, channelId?: number, label = 'Descargar', downloaded = false) => {
    if (downloaded) {
      return (
        <span className="text-green-400 text-[10px] font-medium shrink-0 bg-green-400/10 px-2 py-1 rounded-full">
          DESCARGADO
        </span>
      );
    }
    const ds = downloadStates?.get(msgId);
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
      <button onClick={(e) => { e.stopPropagation(); onDownload(msgId, channelId); }}
        className="bg-netflix-red hover:bg-netflix-red-hover text-white text-xs px-3 py-1.5 rounded-lg transition-all hover:scale-105 font-medium shrink-0">
        {label}
      </button>
    );
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
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
      <div className="relative bg-netflix-dark border border-white/10 rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-hidden shadow-2xl shadow-black/50 animate-scale-in"
        onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose}
          className="absolute top-4 right-4 z-20 w-8 h-8 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/10 transition-colors">✕</button>

        <div className="relative h-48 md:h-56 overflow-hidden">
          {metadata.backdrop ? (
            <img src={metadata.backdrop} alt="" className="w-full h-full object-cover" />
          ) : metadata.poster ? (
            <img src={metadata.poster} alt="" className="w-full h-full object-cover scale-110 blur-sm opacity-60" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-netflix-red/40 via-netflix-dark to-netflix-darker" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-netflix-dark via-netflix-dark/40 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-netflix-dark/70 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-6">
            <h1 className="text-white text-2xl font-bold drop-shadow-lg">{metadata.title || title}</h1>
            <div className="flex items-center gap-3 mt-1.5">
              {metadata.year && <span className="text-gray-300 text-sm">{metadata.year}</span>}
              {metadata.rating && (
                <span className="text-yellow-400 text-sm flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  {metadata.rating.toFixed(1)}
                </span>
              )}
              <span className="text-gray-400 text-sm">{results.length} versiones</span>
            </div>
          </div>
        </div>

        <div className="p-5 overflow-y-auto max-h-[50vh]">
          {groups.map(({ res, mpGroups, mpSingles }) => (
            <div key={res} className="mb-3">
              <button onClick={() => toggleRes(res)}
                className="w-full flex items-center gap-2 text-white font-semibold text-sm mb-2 hover:bg-white/5 rounded-lg px-2 py-1.5 transition-colors">
                <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${collapsed.has(res) ? '' : 'rotate-90'}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                </svg>
                {res}
                <span className="text-gray-500 text-xs font-normal">({mpGroups.length + mpSingles.length})</span>
              </button>
              {!collapsed.has(res) && (
                <div className="space-y-1.5 ml-4">
                  {mpGroups.map(g => (
                    <div key={g.firstId}
                      className="flex items-center gap-3 bg-white/[0.03] border border-white/5 rounded-xl px-4 py-2.5 hover:bg-white/[0.06] transition-all">
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm truncate">{cleanFileName(g.baseName)}</p>
                        <p className="text-gray-500 text-[11px]">{g.parts.length} partes · {formatBytes(g.totalSize)}</p>
                      </div>
                      {downloadBtn(g.firstId, g.channelId, `Descargar (${g.parts.length})`, g.parts[0].downloaded)}
                    </div>
                  ))}
                  {mpSingles.map((r, idx) => (
                    <div key={`${r.id}-${idx}`}
                      className="flex items-center gap-3 bg-white/[0.03] border border-white/5 rounded-xl px-4 py-2.5 hover:bg-white/[0.06] transition-all">
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm truncate">{cleanFileName(r.file_name)}</p>
                        <p className="text-gray-500 text-[11px]">{r.channel_name} · {r.size_str}</p>
                      </div>
                      {downloadBtn(r.id, r.channel_id, 'Descargar', r.downloaded)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className="mt-4 flex justify-end">
            <button onClick={onClose}
              className="text-gray-400 hover:text-white text-sm px-4 py-2 rounded-xl hover:bg-white/5 transition-all">Cerrar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
