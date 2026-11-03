import type { EstadoSiguiente } from '../hooks/useSiguiente';
import { soloPuntero } from '../tv/platform';
import { IconPlay } from './Icons';

const PUNTERO = soloPuntero();

/** Donde va el vídeo encogido (px de la pantalla de 1920x1080). */
export const VIDEO_ENCOGIDO = { left: 96, top: 96, width: 960, height: 540 };
/** Carátulas que se ofrecen. */
export const MAX_RELACIONADOS = 10;

interface Props {
  sig: EstadoSiguiente;
  titulo: string;
  subtitulo?: string;
  /** Dónde está el mando: fila 0 los botones, fila 1 las carátulas. */
  fila: number;
  columna: number;
  onVerCreditos: () => void;
  onSalir: () => void;
  onElegir: (i: number) => void;
}

/**
 * La pantalla del final en la tele, como Netflix: al empezar los créditos de
 * una película (o del último episodio que hay) el vídeo se encoge arriba a la
 * izquierda —lo hace el reproductor— y el resto ofrece qué ver después.
 *
 * El mando es de esta pantalla en cuanto aparece: con el vídeo encogido no
 * tiene sentido saltar 10 s. ▲▼ cambian entre los botones y las carátulas,
 * ◀▶ se mueven y OK elige. El foco es una clase, como en el resto de la app,
 * y lo único que se anima es el `transform` de la carátula enfocada.
 */
export default function FinTitulo({ sig, titulo, subtitulo, fila, columna, onVerCreditos, onSalir, onElegir }: Props) {
  if (sig.decision.tipo !== 'final') return null;
  const botones = [
    { texto: 'Ver créditos', icono: true, accion: onVerCreditos },
    { texto: 'Salir', icono: false, accion: onSalir },
  ];
  const lista = sig.relacionados.slice(0, MAX_RELACIONADOS);
  return (
    <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, #000 0%, #0a0a0a 60%, #141414 100%)' }}>
      <div className="absolute" style={{ left: VIDEO_ENCOGIDO.left + VIDEO_ENCOGIDO.width + 64, top: 120, right: 96 }}>
        <p className="text-caption uppercase tracking-wide text-tv-text3">Acabas de ver</p>
        <p className="mt-3 text-hero font-bold leading-tight">{titulo}</p>
        {subtitulo && <p className="mt-2 text-lead text-tv-text2">{subtitulo}</p>}
        <div className="mt-10 flex items-center space-x-5">
          {botones.map((b, i) => (
            <button key={b.texto} onClick={PUNTERO ? b.accion : undefined}
              className={`inline-flex items-center space-x-3 rounded-lg px-8 h-[68px] text-body font-semibold
                ${fila === 0 && columna === i ? 'bg-white text-black' : 'bg-white/15 text-white'}
                ${PUNTERO ? 'cursor-pointer' : ''}`}>
              {b.icono && <span className="w-7 h-7"><IconPlay /></span>}
              <span>{b.texto}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="absolute" style={{ left: 96, right: 96, top: VIDEO_ENCOGIDO.top + VIDEO_ENCOGIDO.height + 56 }}>
        <p className="text-row font-semibold">Más títulos como este</p>
        {lista.length === 0 ? (
          <p className="mt-4 text-body text-tv-text3">Buscando títulos parecidos…</p>
        ) : (
          <div className="mt-5 flex space-x-6">
            {lista.map((r, i) => {
              const foco = fila === 1 && columna === i;
              return (
                <div key={r.id} onClick={PUNTERO ? () => onElegir(i) : undefined}
                  className={`w-[150px] shrink-0 ${PUNTERO ? 'cursor-pointer' : ''}`}
                  style={{ transform: foco ? 'scale(1.1)' : 'none', transition: 'transform 160ms ease-out',
                           transformOrigin: 'center bottom' }}>
                  <div className={`w-[150px] h-[225px] rounded-lg overflow-hidden bg-tv-surface
                                   ${foco ? 'outline outline-4 outline-white' : ''}`}>
                    {r.poster
                      ? <img src={r.poster} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full p-3 flex items-end text-caption text-tv-text2">{r.title}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-6 text-caption text-tv-text3">
          {PUNTERO ? 'Pulsa una opción' : '▲ ▼ ◀ ▶ eligen · OK confirma · Atrás sale'}
        </p>
      </div>
    </div>
  );
}
