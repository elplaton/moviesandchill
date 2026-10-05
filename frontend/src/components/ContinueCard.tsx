import { useState } from 'react';
import { IconClose, IconPlay } from './ui/Icon';
import type { Watched } from '../utils/progress';

interface Props {
  item: Watched;
  onPlay: () => void;
  onRemove: () => void;
}

function fmt(s: number): string {
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

/**
 * Tarjeta de "Continuar viendo".
 *
 * Es apaisada y no una caratula 2:3 como el resto del catalogo, a proposito:
 * aqui lo que importa no es que el titulo se reconozca de lejos (ya se estaba
 * viendo) sino cuanto queda, y una barra de progreso bajo un fotograma dice
 * eso de un vistazo. Es la misma forma que tienen la fila del movil y la de
 * la tele.
 */
export default function ContinueCard({ item, onPlay, onRemove }: Props) {
  const [roto, setRoto] = useState(false);
  const img = item.backdrop || item.poster;
  const pct = item.duration > 0 ? Math.min(100, (item.position / item.duration) * 100) : 0;
  const queda = item.duration > 0 ? item.duration - item.position : 0;

  return (
    <div className="card relative shrink-0" style={{ width: 'calc(var(--card-w) * 1.55)' }}>
      <button
        onClick={onPlay}
        aria-label={`Reproducir ${item.title}`}
        className="card-media group relative block w-full aspect-video overflow-hidden rounded-card bg-nf-surface text-left shadow-card"
      >
        {img && !roto
          ? <img src={img} alt="" onError={() => setRoto(true)}
                 className="absolute inset-0 h-full w-full object-cover" />
          : <span className="absolute inset-0 grid place-items-center px-3 text-center text-sm text-nf-faint">{item.title}</span>}

        <span className="absolute inset-0 bg-black/20 opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid h-12 w-12 place-items-center rounded-pill bg-black/60 transition-transform duration-200 ease-out group-hover:scale-110">
            <span className="ml-0.5 h-6 w-6 text-white"><IconPlay /></span>
          </span>
        </span>

        {/* Lo que queda, no lo que se lleva visto: es la pregunta de verdad
            cuando se decide si da tiempo a terminarla esta noche. */}
        {item.next_episode
          ? <span className="absolute left-2 top-2 rounded-pill bg-nf-red px-2 py-0.5 text-micro font-semibold uppercase">Siguiente</span>
          : queda > 60 && <span className="absolute right-2 top-2 rounded-pill bg-black/70 px-2 py-0.5 text-micro">Quedan {fmt(queda)}</span>}

        {pct > 0 && (
          <span className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
            <span className="block h-full bg-nf-red" style={{ width: `${pct}%` }} />
          </span>
        )}
      </button>

      <button
        onClick={onRemove}
        aria-label={`Quitar ${item.title} de Continuar viendo`}
        title="Quitar de Continuar viendo"
        className="card-quitar absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-pill bg-black/70 text-white opacity-0 transition-opacity hover:bg-nf-red focus:opacity-100"
      >
        <span className="h-3.5 w-3.5"><IconClose /></span>
      </button>

      <div className="mt-2">
        <p className="truncate text-base font-medium">{item.title}</p>
        <p className="truncate text-sm text-nf-faint">
          {item.next_episode ? `Empezar ${item.subtitle || 'el siguiente episodio'}` : item.subtitle || ' '}
        </p>
      </div>
    </div>
  );
}
