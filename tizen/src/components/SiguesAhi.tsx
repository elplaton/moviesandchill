import { soloPuntero } from '../tv/platform';
import { SALTOS_SIN_PREGUNTAR, type EstadoSiguiente } from '../hooks/useSiguiente';
import { IconPlay } from './Icons';

const PUNTERO = soloPuntero();

/**
 * «¿Sigues ahí?»: tras cuatro capítulos seguidos sin tocar el mando, antes de
 * empezar el quinto (la cuenta la lleva `useSiguiente`). Mientras está
 * arriba el mando es suyo (◀ ▶ y OK, Atrás sale): lo maneja `Player`, que
 * le pasa el `cursor`. En la PS4 se pulsa con el puntero.
 */
export default function SiguesAhi({ sig, cursor, titulo }: { sig: EstadoSiguiente; cursor: number; titulo?: string }) {
  if (!sig.sigues) return null;
  const boton = (i: number, texto: string, onSelect: () => void, icono?: boolean) => (
    <button onClick={PUNTERO ? onSelect : undefined}
      className={`inline-flex items-center justify-center space-x-3 rounded-lg px-10 h-[72px] text-lead font-semibold whitespace-nowrap
        ${cursor === i ? 'bg-white text-black' : 'bg-white/15 text-white'}${PUNTERO ? ' cursor-pointer' : ''}`}>
      {icono && <span className="w-8 h-8"><IconPlay /></span>}
      <span>{texto}</span>
    </button>
  );
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/90 text-center">
      {(sig.titulo || titulo) && (
        <p className="mb-4 text-caption font-bold uppercase tracking-wide text-tv-red">{sig.titulo || titulo}</p>
      )}
      <h2 className="text-hero font-bold">¿Sigues ahí?</h2>
      <p className="mt-4 text-lead text-tv-text2">
        Llevas {SALTOS_SIN_PREGUNTAR + 1} capítulos seguidos. Lo siguiente es el {sig.sigues.label}.
      </p>
      <div className="mt-14 flex items-center space-x-6">
        {boton(0, 'Seguir viendo', sig.seguirViendo, true)}
        {boton(1, 'Salir', sig.salir)}
      </div>
    </div>
  );
}
