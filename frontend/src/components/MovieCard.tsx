import { useState } from 'react';
import DownloadRing, { type RingStatus } from './DownloadRing';
import type { DownloadState } from '../types';

interface MovieCardProps {
  name: string;
  subtitle?: string;
  size?: string;
  posterUrl?: string;
  year?: number;
  rating?: number;
  onPlay?: () => void;
  onDownload?: () => void;
  onCancelDownload?: () => void;
  onDelete?: () => void;
  onClick?: () => void;
  downloaded?: boolean;
  downloadState?: DownloadState;
  hoverLabel?: string;
  actions?: 'play' | 'download' | 'both' | 'click';
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getGradient(name: string): string {
  const h = hashCode(name) % 360;
  const s = 55 + (hashCode(name + 's') % 25);
  return `linear-gradient(160deg, hsl(${h}, ${s}%, 38%), hsl(${(h + 50) % 360}, ${s - 5}%, 18%), hsl(${(h + 20) % 360}, ${s - 15}%, 12%))`;
}

export function cleanFileName(name: string): string {
  return name
    .replace(/\.(mkv|mp4|avi|mov|wmv|flv|webm|m4v|ts|rar|zip|7z|tar\.gz|tar\.bz2|tar|tgz|tbz2)$/i, '')
    .replace(/\.part\d+/i, '')
    .replace(/\.r\d{2,}$/i, '')
    .replace(/\.\d{3,}$/, '')
    .replace(/\s+\d{1,2}x\d{2,}\b.*$/i, '')
    .replace(/\s+(1080p|720p|2160p|4k|zip|rar|7z)\s*$/i, '')
    .replace(/\[.*?\]/g, '')
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function MovieCard({
  name, subtitle, size, posterUrl, year, rating,
  onPlay, onDownload, onCancelDownload, onDelete, onClick,
  downloaded, downloadState, hoverLabel, actions = 'play',
}: MovieCardProps) {
  const [hovered, setHovered] = useState(false);
  const [imgError, setImgError] = useState(false);
  const displayName = cleanFileName(name);

  return (
    <div
      className="relative shrink-0 w-40 md:w-48 transition-all duration-400 group cursor-pointer"
      style={{
        transform: hovered ? 'scale(1.1) translateY(-4px)' : 'scale(1) translateY(0)',
        zIndex: hovered ? 20 : 1,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      <div
        className="w-full aspect-[2/3] rounded-2xl flex items-end p-3.5 relative overflow-hidden shadow-lg bg-netflix-card"
        style={{
          boxShadow: hovered
            ? '0 8px 40px rgba(0,0,0,0.6), 0 2px 12px rgba(229,9,20,0.15)'
            : '0 2px 8px rgba(0,0,0,0.3)',
          transition: 'box-shadow 0.4s ease, transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        }}
      >
        {posterUrl && !imgError ? (
          <img
            src={posterUrl}
            alt={displayName}
            className="absolute inset-0 w-full h-full object-cover rounded-2xl"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="absolute inset-0 rounded-2xl" style={{ background: getGradient(name) }} />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/25 to-transparent rounded-2xl" />
        <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/5" />

        {downloaded && (
          <span className="absolute top-3 right-3 bg-netflix-red/90 backdrop-blur-sm text-white text-[10px] px-2 py-1 rounded-full font-medium shadow-lg z-10">
            DESCARGADO
          </span>
        )}

        {rating && (
          <span className="absolute top-3 left-3 bg-black/70 backdrop-blur-sm text-yellow-400 text-[10px] px-2 py-1 rounded-full font-medium z-10 flex items-center gap-1">
            <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            {rating.toFixed(1)}
          </span>
        )}

        {downloadState && downloadState.status !== 'done' && downloadState.status !== 'error' && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[1px] flex flex-col items-center justify-center gap-1.5 rounded-2xl z-10">
            <DownloadRing
              progress={downloadState.progress}
              status={downloadState.status as RingStatus}
              onCancel={onCancelDownload}
            />
            <span className="text-white text-[10px] font-medium">
              {downloadState.status === 'downloading' && `${downloadState.progress}%`}
              {downloadState.status === 'extracting' && 'Extrayendo...'}
              {downloadState.status === 'converting' && 'Convirtiendo...'}
            </span>
          </div>
        )}

        {(!downloadState || downloadState.status === 'done' || downloadState.status === 'error') && hovered && (
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2.5 rounded-2xl animate-fade-in z-10">
            {(actions === 'play' || actions === 'both') && onPlay && (
              <button onClick={(e) => { e.stopPropagation(); onPlay(); }}
                className="bg-white/95 text-black rounded-full p-3 hover:bg-white transition-all hover:scale-110 shadow-2xl">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
            )}
            {(actions === 'download' || actions === 'both') && onDownload && (
              <button onClick={(e) => { e.stopPropagation(); onDownload(); }}
                className="bg-netflix-red/95 backdrop-blur-sm text-white text-xs px-5 py-2 rounded-full hover:bg-netflix-red transition-all hover:scale-105 font-semibold shadow-xl">
                Descargar
              </button>
            )}
            {actions === 'click' && hoverLabel && (
              <div className="text-white/80 text-xs font-medium">{hoverLabel}</div>
            )}
            {onDelete && (
              <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="text-white/60 text-xs hover:text-white/90 transition-colors mt-1">
                Eliminar
              </button>
            )}
          </div>
        )}

        <div className="relative z-10 w-full">
          <p className="text-white text-xs font-semibold leading-tight line-clamp-2 drop-shadow-md">{displayName}</p>
          {year && <p className="text-gray-300 text-[10px] mt-0.5">{year}</p>}
          {subtitle && <p className="text-gray-300 text-[10px] mt-0.5 drop-shadow">{subtitle}</p>}
          {size && <p className="text-gray-400 text-[10px] mt-0.5">{size}</p>}
        </div>
      </div>
    </div>
  );
}
