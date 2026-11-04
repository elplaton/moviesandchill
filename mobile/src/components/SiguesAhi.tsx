import { IPlay } from './Icons';
import { SALTOS_SIN_PREGUNTAR, type EstadoSiguiente } from '../hooks/useSiguiente';

/**
 * «¿Sigues ahí?»: tras cuatro capítulos seguidos sin tocar nada, antes de
 * empezar el quinto (la cuenta la lleva `useSiguiente`). Tapa la pantalla
 * entera: el vídeo está en pausa y lo único que queda es contestar.
 */
export default function SiguesAhi({ sig, titulo }: { sig: EstadoSiguiente; titulo?: string }) {
  if (!sig.sigues) return null;
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/90 px-6 text-center">
      {(sig.titulo || titulo) && (
        <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.16em] text-nf-red">{sig.titulo || titulo}</p>
      )}
      <h2 className="text-[26px] font-bold">¿Sigues ahí?</h2>
      <p className="mt-2 text-[15px] text-nf-text2">
        Llevas {SALTOS_SIN_PREGUNTAR + 1} capítulos seguidos. Lo siguiente es el {sig.sigues.label}.
      </p>
      <div className="mt-8 flex w-full max-w-sm flex-col gap-3">
        <button onClick={sig.seguirViendo}
          className="flex h-[52px] items-center justify-center gap-2 rounded-xl bg-white text-[16px] font-semibold text-black active:bg-white/80">
          <span className="w-5 h-5"><IPlay /></span>Seguir viendo
        </button>
        <button onClick={sig.salir}
          className="h-[52px] rounded-xl bg-black/70 text-[16px] font-semibold ring-1 ring-white/40 active:bg-white/20">
          Salir
        </button>
      </div>
    </div>
  );
}
