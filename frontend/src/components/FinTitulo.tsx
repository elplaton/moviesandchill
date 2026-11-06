import { IconClose } from './ui/Icon';
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
 * La pantalla del final, como Netflix: al empezar los créditos de una película
 * (o del último episodio que hay de una serie) el vídeo se encoge arriba a la
 * izquierda —lo hace el reproductor— y sigue con los créditos, y el resto de
 * la pantalla ofrece qué ver después.
 *
 * Sin botón de «Ver créditos» (esto existe para saltarlos); pulsar el vídeo
 * encogido lo devuelve a pantalla completa por si alguien quiere quedarse.
 * Antes, al acabar una película el reproductor se cerraba de golpe y
 * devolvía a la portada.
 */
export default function FinTitulo({ sig, titulo, subtitulo, onSalir, onElegir }: Props) {
  if (sig.decision.tipo !== 'final') return null;
  return (
    <div className="absolute inset-0 z-10 animate-fade-in"
      style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(10,10,10,0.92) 55%, #0a0a0a 100%)' }}>
      {/* Al lado del vídeo encogido. */}
      <div className="absolute right-[4%] top-[10vh] left-[calc(8vw+min(44vw,82vh))]">
        <p className="text-sm font-semibold uppercase tracking-wide text-nf-faint">Acabas de ver</p>
        <p className="mt-2 text-3xl font-bold leading-tight">{titulo}</p>
        {subtitulo && <p className="mt-1 text-lg text-nf-dim">{subtitulo}</p>}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button onClick={onSalir}
            className="flex items-center gap-2 rounded bg-white px-5 py-3 text-base font-semibold text-black hover:bg-white/85">
            <span className="w-4 h-4"><IconClose /></span>
            Salir
          </button>
        </div>
      </div>

      <div className="absolute inset-x-[4%] bottom-[4vh]">
        <p className="mb-3 text-xl font-semibold">Más títulos como este</p>
        {sig.relacionados.length === 0 ? (
          <p className="text-base text-nf-faint">Buscando títulos parecidos…</p>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {sig.relacionados.slice(0, 12).map((r) => (
              <button key={r.id} onClick={() => onElegir(r)} title={r.title}
                className="group w-[min(9.5rem,17vh)] shrink-0 text-left">
                <div className="aspect-[2/3] overflow-hidden rounded bg-nf-surface ring-white/80
                                transition-transform duration-200 group-hover:scale-105 group-hover:ring-2">
                  {r.poster
                    ? <img src={r.poster} alt="" loading="lazy" className="h-full w-full object-cover" />
                    : <div className="grid h-full place-items-center p-2 text-center text-sm text-nf-dim">{r.title}</div>}
                </div>
                <p className="mt-1.5 truncate text-sm text-nf-dim group-hover:text-white">{r.title}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
