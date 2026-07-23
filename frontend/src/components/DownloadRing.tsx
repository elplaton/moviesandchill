import { useEffect, useState } from 'react';

export type RingStatus = 'downloading' | 'extracting' | 'converting' | 'done' | 'error' | 'idle';

interface DownloadRingProps {
  progress: number;
  status: RingStatus;
  onCancel?: () => void;
  size?: number;
  downloadedStr?: string;
  totalStr?: string;
  speed?: string;
}

export default function DownloadRing({ progress, status, onCancel, size = 44, downloadedStr, totalStr, speed }: DownloadRingProps) {
  const [fading, setFading] = useState(false);
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;

  useEffect(() => {
    if (status === 'done' || status === 'error') {
      const t = setTimeout(() => setFading(true), 2000);
      return () => clearTimeout(t);
    }
    setFading(false);
  }, [status]);

  const color = status === 'done' ? '#2ECC40'
    : status === 'error' ? '#E50914'
    : status === 'extracting' || status === 'converting' ? '#F5A623'
    : '#E50914';

  return (
    <div className={`relative flex flex-col items-center gap-1 transition-opacity duration-500 ${fading ? 'opacity-0' : 'opacity-100'}`}>
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={strokeWidth} />
          {(status === 'downloading' || status === 'extracting' || status === 'converting') && (
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
              strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
              className="transition-all duration-500" />
          )}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          {status === 'downloading' && onCancel && (
            <button onClick={(e) => { e.stopPropagation(); onCancel(); }}
              className="w-2.5 h-2.5 bg-white/90 hover:bg-white rounded-sm transition-colors" title="Cancelar" />
          )}
          {status === 'done' && (
            <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
          {status === 'error' && (
            <span className="text-netflix-red text-xs font-bold">✕</span>
          )}
          {status === 'extracting' && (
            <span className="text-yellow-400 text-[8px] font-semibold">EXT</span>
          )}
          {status === 'converting' && (
            <span className="text-yellow-400 text-[8px] font-semibold">DTS</span>
          )}
          {status === 'idle' && (
            <svg className="w-5 h-5 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          )}
        </div>
      </div>
      {(downloadedStr || totalStr || speed) && (
        <div className="text-white/70 text-[9px] text-center leading-tight">
          {speed && <span>{speed}</span>}
          {speed && (downloadedStr || totalStr) && <span> &middot; </span>}
          {downloadedStr && totalStr && <span>{downloadedStr} / {totalStr}</span>}
          {downloadedStr && !totalStr && <span>{downloadedStr}</span>}
        </div>
      )}
    </div>
  );
}
