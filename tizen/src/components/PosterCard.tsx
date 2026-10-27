import { memo, useCallback, useState } from 'react';
import { applyFocus } from '../focus/engine';
import { useFocusItem } from '../focus/react';
import { setFeatured } from '../tv/featured';
import type { Featured } from '../types';

interface Props {
  item: Featured;
  index?: number;
  focusKey?: string;
  autoFocus?: boolean;
  onSelect: (item: Featured) => void;
  /** Etiqueta pequeña bajo la caratula (solo cuando hace falta distinguir archivos). */
  caption?: string;
  /** Marca de "ya en disco". */
  downloaded?: boolean;
  /** Anillo de descarga en curso, 0-100. */
  downloading?: number;
  busyLabel?: string;
  /** Puesto en un top: el número grande a la izquierda de la carátula. */
  puesto?: number;
  /** Carátula atenuada con esta etiqueta encima ("No la tenemos"). */
  aviso?: string;
}

/** El número del top: ancho reservado según cifras y lo que lo pisa la carátula. */
const SOLAPE = 32;
function anchoPuesto(n: number): number {
  return n < 10 ? 150 : 250;
}

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

/**
 * Caratula 2:3 sin texto encima: el titulo y los datos los enseña el panel de
 * arriba cuando la tarjeta tiene el foco. Sin caratula se pinta el titulo
 * grande sobre un degradado.
 */
function PosterCard({ item, index, focusKey, autoFocus, onSelect, caption, downloaded, downloading, busyLabel, puesto, aviso }: Props) {
  const [broken, setBroken] = useState(false);
  const handleEnter = useCallback(() => onSelect(item), [onSelect, item]);
  const handleFocus = useCallback(() => setFeatured(item), [item]);

  const { ref, focusKey: id } = useFocusItem<HTMLDivElement>({
    focusKey: focusKey || item.key,
    index,
    autoFocus,
    onEnter: handleEnter,
    onFocus: handleFocus,
  });
  const onMouseEnter = useCallback(() => applyFocus(id), [id]);

  const hue = hashHue(item.title);
  const progress = item.progress;
  // Con puesto, la tarjeta enfocable es número + carátula: así el número
  // escala con ella y el carril alinea el número (no la carátula) al margen.
  const slot = puesto !== undefined ? anchoPuesto(puesto) : 0;

  return (
    <div
      ref={ref}
      className={`tv-card relative shrink-0${puesto !== undefined ? ' flex items-end' : ''}`}
      style={{ width: puesto !== undefined ? `calc(var(--card-w) + ${slot - SOLAPE}px)` : 'var(--card-w)' }}
      onMouseEnter={onMouseEnter}
      onClick={handleEnter}
    >
      {puesto !== undefined && (
        <span className={`tv-puesto shrink-0${puesto >= 10 ? ' tv-puesto-2' : ''}`} aria-hidden="true"
          style={{ width: slot, marginRight: -SOLAPE }}>{puesto}</span>
      )}
      <div className="relative shrink-0" style={{ width: 'var(--card-w)' }}>
      <div className="tv-poster relative rounded-md overflow-hidden bg-tv-surface" style={{ width: 'var(--card-w)', height: 'var(--card-h)' }}>
        {item.poster && !broken ? (
          <img src={item.poster} alt="" className="absolute inset-0 w-full h-full object-cover"
            loading="lazy" decoding="async" onError={() => setBroken(true)} />
        ) : (
          <div className="absolute inset-0 flex items-end p-4"
            style={{ background: `linear-gradient(160deg, hsl(${hue}, 45%, 34%), hsl(${(hue + 40) % 360}, 40%, 14%))` }}>
            <span className="text-lead font-bold leading-tight line-clamp-4 drop-shadow">{item.title}</span>
          </div>
        )}

        {downloaded && (
          <span className="absolute top-2 right-2 w-8 h-8 rounded-full bg-tv-ok text-black flex items-center justify-center shadow">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          </span>
        )}

        {downloading !== undefined && (
          <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center space-y-3">
            <div className="relative w-[72px] h-[72px]">
              <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="3" />
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="#E50914" strokeWidth="3" strokeLinecap="round"
                  strokeDasharray={`${Math.max(0, Math.min(100, downloading)) * 0.9738} 100`} />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-caption font-bold">{Math.round(downloading)}%</span>
            </div>
            {busyLabel && <span className="text-caption text-tv-text2">{busyLabel}</span>}
          </div>
        )}

        {aviso && (
          // Velo solido y no un filtro: en la GPU de la tele un grayscale es
          // un pase mas por tarjeta, y a tres metros el velo se lee igual.
          <div className="absolute inset-0 bg-black/60 flex items-end justify-center p-3">
            <span className="px-3 py-1 rounded bg-black/80 border border-white/25 text-caption font-semibold text-tv-text truncate">{aviso}</span>
          </div>
        )}

        {progress !== undefined && progress > 0 && (
          <div className="tv-card-progress absolute left-0 right-0 bottom-0 h-[6px] bg-white/25">
            <div className="h-full bg-tv-red" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>
      {caption && (
        <p className="mt-2 text-caption text-tv-text2 truncate text-center" style={{ width: 'var(--card-w)' }}>{caption}</p>
      )}
      </div>
    </div>
  );
}

function same(a: Props, b: Props) {
  return a.item === b.item && a.index === b.index && a.focusKey === b.focusKey && a.autoFocus === b.autoFocus
    && a.caption === b.caption && a.downloaded === b.downloaded && a.downloading === b.downloading && a.busyLabel === b.busyLabel
    && a.puesto === b.puesto && a.aviso === b.aviso;
}

export default memo(PosterCard, same);
