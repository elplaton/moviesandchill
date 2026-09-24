import { memo, useState, type ReactNode } from 'react';
import { IconStar } from './ui/Icon';

export interface CardProps {
  title: string;
  poster?: string;
  /** Línea bajo el título: año, nº de episodios, tamaño… */
  meta?: string;
  rating?: number;
  onOpen: () => void;
  /** Acciones que aparecen sobre la carátula al pasar el ratón. */
  actions?: ReactNode;
  /** Marca de esquina: "En disco", "3 versiones"… */
  badge?: string;
  badgeTone?: 'ok' | 'neutral';
  /** Barra de progreso de lo ya visto (0-1). */
  progress?: number;
  /** Capa que sustituye a las acciones mientras se descarga. */
  busy?: ReactNode;
}

function hue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

/**
 * Carátula 2:3 con el título debajo.
 *
 * En escritorio el hover es una herramienta real, así que la tarjeta crece y
 * saca sus acciones encima de la carátula; el texto vive debajo y se lee
 * siempre, en vez de ir superpuesto sobre la imagen como antes (donde tapaba
 * el cartel y se leía mal sobre fondos claros).
 */
function Card({ title, poster, meta, rating, onOpen, actions, badge, badgeTone = 'neutral', progress, busy }: CardProps) {
  const [broken, setBroken] = useState(false);
  const h = hue(title);

  return (
    <div className="card relative shrink-0" style={{ width: 'var(--card-w)' }}>
      <button
        onClick={onOpen}
        aria-label={title}
        className="card-media relative block w-full aspect-[2/3] rounded-card overflow-hidden bg-nf-surface shadow-card text-left"
      >
        {poster && !broken ? (
          <img src={poster} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)}
            className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <span className="absolute inset-0 flex items-end p-3 text-sm font-semibold text-white/90 line-clamp-4"
            style={{ background: `linear-gradient(160deg, hsl(${h},42%,32%), hsl(${(h + 40) % 360},38%,13%))` }}>
            {title}
          </span>
        )}

        {rating ? (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded bg-black/75 px-1.5 py-0.5 text-micro font-semibold text-nf-warn">
            <span className="w-3 h-3"><IconStar /></span>{rating.toFixed(1)}
          </span>
        ) : null}

        {badge && (
          <span className={`absolute top-2 right-2 rounded px-1.5 py-0.5 text-micro font-semibold ${
            badgeTone === 'ok' ? 'bg-nf-ok/90 text-black' : 'bg-black/75 text-white'}`}>
            {badge}
          </span>
        )}

        {busy ? (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70">{busy}</span>
        ) : actions ? (
          <span className="card-info absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55">{actions}</span>
        ) : null}

        {progress !== undefined && progress > 0 && (
          <span className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
            <span className="block h-full bg-nf-red" style={{ width: `${Math.round(progress * 100)}%` }} />
          </span>
        )}
      </button>

      <p className="mt-2 text-base font-medium leading-snug line-clamp-2">{title}</p>
      {meta && <p className="text-xs text-nf-faint truncate">{meta}</p>}
    </div>
  );
}

export default memo(Card);
