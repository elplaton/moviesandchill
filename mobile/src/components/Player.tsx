import { useEffect, useRef } from 'react';
import { getAccessToken } from '../services/api';
import { clearWatched, resumePoint, setWatched } from '../utils/progress';
import { IClose } from './Icons';

interface Props { path: string; title: string; subtitle?: string; poster?: string; backdrop?: string; onClose: () => void }

/**
 * Reproductor: el <video> nativo con sus controles, que en iPhone abre el
 * reproductor del sistema (pantalla completa, AirPlay, Picture in Picture).
 * Guarda la posicion y reanuda donde se dejo.
 */
export default function Player({ path, title, subtitle, poster, backdrop, onClose }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const src = `/api/stream?path=${encodeURIComponent(path)}&token=${encodeURIComponent(getAccessToken() || '')}`;

  useEffect(() => {
    const v = ref.current; if (!v) return;
    const start = resumePoint(path);
    let last = 0;
    const onMeta = () => { if (start > 0) v.currentTime = start; };
    const onTime = () => {
      const now = Date.now(); if (now - last < 5000 || !v.duration) return; last = now;
      if (v.currentTime / v.duration >= 0.97) clearWatched(path);
      else setWatched({ path, title, subtitle, poster, backdrop, position: v.currentTime, duration: v.duration });
    };
    const onEnded = () => { clearWatched(path); };
    v.addEventListener('loadedmetadata', onMeta); v.addEventListener('timeupdate', onTime); v.addEventListener('ended', onEnded);
    document.body.style.overflow = 'hidden';
    return () => {
      v.removeEventListener('loadedmetadata', onMeta); v.removeEventListener('timeupdate', onTime); v.removeEventListener('ended', onEnded);
      document.body.style.overflow = '';
      if (v.duration && v.currentTime > 0) setWatched({ path, title, subtitle, poster, backdrop, position: v.currentTime, duration: v.duration });
    };
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 z-[70] bg-black flex flex-col">
      <div className="flex items-center gap-3 px-3 h-[52px] shrink-0" style={{ paddingTop: 'var(--safe-t)' }}>
        <button onClick={onClose} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center tap"><span className="w-5 h-5"><IClose /></span></button>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold truncate">{title}</p>
          {subtitle && <p className="text-[12px] text-nf-text2 truncate">{subtitle}</p>}
        </div>
      </div>
      <video ref={ref} src={src} controls autoPlay playsInline poster={backdrop} className="flex-1 w-full bg-black object-contain" />
    </div>
  );
}
