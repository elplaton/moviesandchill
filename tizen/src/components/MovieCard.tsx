import { memo, useCallback, useState } from 'react';
import { applyFocus } from '../focus/engine';
import { useFocusItem } from '../focus/react';
import DownloadRing, { type RingStatus } from './DownloadRing';
import { cleanFileName } from '../utils/text';
import type { DownloadState } from '../types';

interface MovieCardProps {
  name: string;
  subtitle?: string;
  size?: string;
  posterUrl?: string;
  year?: number;
  rating?: number;
  genres?: string[];
  onPlay?: () => void;
  onDownload?: () => void;
  onCancelDownload?: () => void;
  onDelete?: () => void;
  onClick?: () => void;
  downloaded?: boolean;
  downloadState?: DownloadState;
  hoverLabel?: string;
  actions?: 'play' | 'download' | 'both' | 'click';
  focusKey?: string;
  forceFocus?: boolean;
  /** Posicion dentro del carril. */
  index?: number;
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

function MovieCard({
  name, subtitle, size, posterUrl, year, rating, genres,
  onPlay, onDownload, onCancelDownload, onDelete, onClick,
  downloaded, downloadState, hoverLabel, actions = 'play', focusKey, forceFocus, index,
}: MovieCardProps) {
  const [imgError, setImgError] = useState(false);
  const displayName = cleanFileName(name);

  // Enter ejecuta la accion principal de la tarjeta.
  const handleEnter = useCallback(() => {
    if (onClick) onClick();
    else if (onPlay) onPlay();
    else if (onDownload) onDownload();
  }, [onClick, onPlay, onDownload]);

  const { ref, focusKey: id } = useFocusItem<HTMLDivElement>({
    focusKey,
    index,
    autoFocus: forceFocus,
    onEnter: handleEnter,
  });

  // Los mandos con puntero si generan hover: se traduce a movimiento de foco
  // para que solo exista un concepto de "elemento activo".
  const handleMouseEnter = useCallback(() => { applyFocus(id); }, [id]);

  const busy = !!downloadState
    && downloadState.status !== 'done'
    && downloadState.status !== 'error';

  return (
    <div
      ref={ref}
      className="mc-card relative shrink-0 w-40 md:w-48 cursor-pointer"
      onMouseEnter={handleMouseEnter}
      onClick={onClick}
    >
      <div className="mc-poster w-full aspect-[2/3] rounded-2xl flex items-end p-3.5 relative overflow-hidden bg-netflix-card">
        {posterUrl && !imgError ? (
          <img
            src={posterUrl}
            alt={displayName}
            className="absolute inset-0 w-full h-full object-cover rounded-2xl"
            loading="lazy"
            decoding="async"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="absolute inset-0 rounded-2xl" style={{ background: getGradient(name) }} />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/25 to-transparent rounded-2xl" />
        <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/5" />

        {downloaded && (
          <span className="absolute top-3 right-3 bg-netflix-red text-white text-[10px] px-2 py-1 rounded-full font-medium z-10">
            DESCARGADO
          </span>
        )}

        {rating && (
          <span className="absolute top-3 left-3 bg-black/85 text-yellow-400 text-[10px] px-2 py-1 rounded-full font-medium z-10 flex items-center gap-1">
            <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            {rating.toFixed(1)}
          </span>
        )}

        {busy && downloadState && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1.5 rounded-2xl z-10">
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

        {/* Siempre en el DOM; lo muestra la clase .is-focused desde CSS, para
            que enfocar no tenga que re-renderizar la tarjeta. */}
        {!busy && (
          <div className="mc-actions absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-2.5 rounded-2xl z-10">
            {(actions === 'play' || actions === 'both') && onPlay && (
              <span className="bg-white/95 text-black rounded-full p-3 shadow-2xl">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            )}
            {(actions === 'download' || actions === 'both') && onDownload && (
              <span className="bg-netflix-red text-white text-xs px-5 py-2 rounded-full font-semibold shadow-xl">
                Descargar
              </span>
            )}
            {actions === 'click' && hoverLabel && (
              <div className="text-white/80 text-xs font-medium">{hoverLabel}</div>
            )}
            {onDelete && (
              <div className="text-white/60 text-xs mt-1">Eliminar</div>
            )}
          </div>
        )}

        <div className="relative z-10 w-full">
          <p className="text-white text-xs font-semibold leading-tight line-clamp-2 drop-shadow-md">{displayName}</p>
          {year && <p className="text-gray-300 text-[10px] mt-0.5">{year}</p>}
          {genres && genres.length > 0 && (
            <p className="text-gray-400 text-[9px] mt-0.5">{genres.slice(0, 2).join(' · ')}</p>
          )}
          {subtitle && <p className="text-gray-300 text-[10px] mt-0.5 drop-shadow">{subtitle}</p>}
          {size && <p className="text-gray-400 text-[10px] mt-0.5">{size}</p>}
        </div>
      </div>
    </div>
  );
}

/**
 * Se comparan solo los datos, no las funciones.
 *
 * Las paginas pasan callbacks en linea (`onClick={() => abrir(item)}`), que
 * cambian de identidad en cada render del padre. Sin esto, cada mensaje de
 * progreso del WebSocket (uno por segundo) repintaria las ~80 tarjetas de la
 * pantalla. Los callbacks se cierran sobre datos estables (el item de la fila),
 * asi que conservar el primero es seguro.
 */
function sameData(a: MovieCardProps, b: MovieCardProps): boolean {
  return (
    a.name === b.name &&
    a.subtitle === b.subtitle &&
    a.size === b.size &&
    a.posterUrl === b.posterUrl &&
    a.year === b.year &&
    a.rating === b.rating &&
    a.downloaded === b.downloaded &&
    a.hoverLabel === b.hoverLabel &&
    a.actions === b.actions &&
    a.focusKey === b.focusKey &&
    a.index === b.index &&
    a.forceFocus === b.forceFocus &&
    a.downloadState?.status === b.downloadState?.status &&
    a.downloadState?.progress === b.downloadState?.progress &&
    (a.genres === b.genres || a.genres?.join() === b.genres?.join())
  );
}

export default memo(MovieCard, sameData);
