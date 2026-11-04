import Button from './ui/Button';
import { IconPlay } from './ui/Icon';
import { SALTOS_SIN_PREGUNTAR, type EstadoSiguiente } from '../hooks/useSiguiente';

/**
 * «¿Sigues ahí?»: tras cuatro capítulos seguidos sin tocar nada, antes de
 * empezar el quinto (la cuenta la lleva `useSiguiente`). Tapa la pantalla
 * entera a propósito, al revés que la tarjeta del siguiente episodio: aquí el
 * vídeo está en pausa y lo único que queda por hacer es contestar.
 */
export default function SiguesAhi({ sig, titulo }: { sig: EstadoSiguiente; titulo?: string }) {
  if (!sig.sigues) return null;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/85 animate-fade-in"
      onClick={(e) => e.stopPropagation()}>
      <div className="max-w-xl px-6 text-center">
        {(sig.titulo || titulo) && (
          <p className="mb-3 text-micro font-bold uppercase tracking-[0.18em] text-nf-red">{sig.titulo || titulo}</p>
        )}
        <h2 className="text-page font-bold">¿Sigues ahí?</h2>
        <p className="mt-3 text-base text-nf-dim">
          Llevas {SALTOS_SIN_PREGUNTAR + 1} capítulos seguidos. Lo siguiente es el {sig.sigues.label}.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Button variant="light" icon={<IconPlay />} onClick={sig.seguirViendo} autoFocus>Seguir viendo</Button>
          <Button variant="ghost" onClick={sig.salir}>Salir</Button>
        </div>
      </div>
    </div>
  );
}
