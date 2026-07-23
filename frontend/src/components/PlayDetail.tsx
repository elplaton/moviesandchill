import { useEffect } from 'react';
import type { TMDBMetadata } from '../types';

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
      <div className="relative bg-netflix-dark border border-white/10 rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl shadow-black/50 animate-scale-in"
        onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose}
          className="absolute top-4 right-4 z-20 w-8 h-8 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/10 transition-colors">✕</button>

        <div className="relative h-64 md:h-80 overflow-hidden">
          {metadata.backdrop ? (
            <img src={metadata.backdrop} alt="" className="w-full h-full object-cover" />
          ) : metadata.poster ? (
            <img src={metadata.poster} alt="" className="w-full h-full object-cover scale-110 blur-sm opacity-60" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-netflix-red/40 via-netflix-dark to-netflix-darker" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-netflix-dark via-netflix-dark/30 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-netflix-dark/70 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-6 md:p-8">
            <h1 className="text-white text-2xl md:text-3xl font-bold drop-shadow-lg tracking-tight">
              {metadata.title || name}
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
              <span className="text-gray-400 text-sm">{size}</span>
            </div>
            {metadata.overview && (
              <p className="text-gray-300 text-sm mt-3 line-clamp-3 max-w-xl leading-relaxed">{metadata.overview}</p>
            )}
          </div>
        </div>

        <div className="p-5 flex items-center gap-3">
          <a href={streamUrl(path)} target="_blank" rel="noreferrer"
            className="flex-1 bg-netflix-red hover:bg-netflix-red-hover text-white font-semibold rounded-xl py-3 text-sm transition-all hover:scale-105 shadow-lg flex items-center justify-center gap-2">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            Abrir en pestaña
          </a>
          {onDelete && (
            <button onClick={onDelete}
              className="bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl py-3 px-5 text-sm transition-all border border-white/10">
              Eliminar
            </button>
          )}
        </div>
        <div className="px-5 pb-5">
          <video
            src={streamUrl(path)}
            controls
            autoPlay
            className="w-full rounded-xl bg-black max-h-[60vh]"
            style={{ minHeight: 300 }}
          >
            Tu navegador no soporta reproduccion de video.
          </video>
        </div>
      </div>
    </div>
  );
}
