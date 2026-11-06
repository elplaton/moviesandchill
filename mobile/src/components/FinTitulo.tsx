import { IClose } from './Icons';
import type { EstadoSiguiente } from '../hooks/useSiguiente';
import type { Relacionado } from '../services/siguiente';

interface Props {
  sig: EstadoSiguiente;
  titulo: string;
  subtitulo?: string;
  onSalir: () => void;
  onElegir: (r: Relacionado) => void;
}

/**
 * La pantalla del final en el teléfono, como Netflix: al empezar los créditos
 * de una película (o del último episodio que hay) el vídeo se encoge arriba
 * —lo hace el reproductor— y sigue con los créditos; debajo, qué ver después.
 *
 * En vertical el vídeo va arriba y no a un lado como en la web: con tres
 * carátulas por fila se ven seis sin desplazar, que es lo que cabe en una
 * mano. Sin botón de «Ver créditos» (esto existe para saltarlos); tocar el
 * vídeo encogido lo devuelve a pantalla completa por si alguien quiere
 * quedarse.
 */
export default function FinTitulo({ sig, titulo, subtitulo, onSalir, onElegir }: Props) {
  if (sig.decision.tipo !== 'final') return null;
  return (
    <div className="absolute inset-x-0 bottom-0 top-[38%] z-10 overflow-y-auto bg-nf-bg px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-nf-text3">Acabas de ver</p>
      <p className="mt-1 text-[22px] font-bold leading-tight">{titulo}</p>
      {subtitulo && <p className="text-[14px] text-nf-text2">{subtitulo}</p>}
      <div className="mt-4 flex gap-2">
        <button onClick={onSalir}
          className="flex h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-white text-[15px]
                     font-semibold text-black active:bg-white/85">
          <span className="w-4 h-4"><IClose /></span>
          Salir
        </button>
      </div>

      <p className="mb-3 mt-6 text-[17px] font-bold">Más títulos como este</p>
      {sig.relacionados.length === 0 ? (
        <p className="text-[14px] text-nf-text3">Buscando títulos parecidos…</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {sig.relacionados.slice(0, 12).map((r) => (
            <button key={r.id} onClick={() => onElegir(r)} className="text-left active:opacity-70">
              <div className="aspect-[2/3] overflow-hidden rounded-lg bg-nf-card">
                {r.poster
                  ? <img src={r.poster} alt="" loading="lazy" className="h-full w-full object-cover" />
                  : <div className="grid h-full place-items-center p-2 text-center text-[12px] text-nf-text2">{r.title}</div>}
              </div>
              <p className="mt-1 truncate text-[12px] text-nf-text2">{r.title}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
