import { useEffect, useRef } from 'react';
import type { TMDBMetadata } from '../types';
import FocusableButton from './FocusableButton';

interface PlayDetailProps {
  name: string;
  size: string;
  path: string;
  metadata: TMDBMetadata;
  onClose: () => void;
  streamUrl: (path: string) => string;
  onDelete?: () => void;
}

export default function PlayDetail({ name, size, path, metadata, onClose, streamUrl, onDelete }: PlayDetailProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Backspace' || e.key === '10009') onClose();
    };
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const toggleFullscreen = () => {
    const v = videoRef.current;
    if (!v) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      v.requestFullscreen?.();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 bg-netflix-dark/90">
        <span className="text-white text-sm font-medium truncate">{metadata.title || name}</span>
        <div className="flex items-center gap-2">
          <FocusableButton onClick={toggleFullscreen}
            className="bg-white/10 hover:bg-white/20 text-white text-sm rounded-lg px-3 py-1.5 transition-colors">
            Pantalla completa
          </FocusableButton>
          {onDelete && (
            <FocusableButton onClick={onDelete}
              className="bg-white/10 hover:bg-white/20 text-white text-sm rounded-lg px-3 py-1.5 transition-colors">
              Eliminar
            </FocusableButton>
          )}
          <FocusableButton onClick={onClose}
            className="bg-netflix-red hover:bg-netflix-red-hover text-white text-sm rounded-lg px-3 py-1.5 transition-colors">
            Cerrar
          </FocusableButton>
        </div>
      </div>

      <video
        ref={videoRef}
        src={streamUrl(path)}
        controls
        autoPlay
        className="flex-1 w-full bg-black"
      >
        Tu navegador no soporta reproduccion de video.
      </video>
    </div>
  );
}
