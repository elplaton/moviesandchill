import Button from './ui/Button';
import { IconClose, IconDownload, IconPlay } from './ui/Icon';
import { listar } from '../services/siguiente';
import type { EstadoSiguiente } from '../hooks/useSiguiente';

/**
 * La tarjeta del final de un capítulo, abajo a la derecha del reproductor.
 *
 * **Un solo botón**, y la barra de arriba es ese botón pulsándose solo. Por
 * eso el texto lleva escrito lo que va a pasar («Ver 3x08 y descargar 3x09»)
 * en vez de un «Siguiente» genérico: si la barra llega al final y arranca una
 * descarga, tiene que haber estado dicho antes.
 *
 * Dos formas, y la decide `useSiguiente`:
 *
 *   el siguiente está en disco   → botón de ver (y de paso dejar bajando el
 *                                  de después, si delante solo quedaba ése),
 *                                  con la barra que avanza sola.
 *   no queda nada descargado     → botón de descargar, **sin** barra: lo que
 *                                  puede pasar sin que nadie toque nada es
 *                                  seguir viendo, no gastar disco y cuota.
 *
 * Va en una esquina y no en el centro porque los créditos se siguen viendo
 * detrás: tapar la pantalla entera para preguntar algo que se puede ignorar
 * es lo que hace que la gente busque cómo desactivarlo.
 */
export default function NextUp({ sig }: { sig: EstadoSiguiente }) {
  const d = sig.decision;
  // La pantalla del final (película o último episodio) es otra: FinTitulo.
  if (d.tipo === 'final') return null;
  if (d.tipo === 'nada' && !sig.mensaje) return null;

  // Ver el siguiente: un solo botón sobre los créditos, que es la cuenta
  // atrás (se va llenando y, al llenarse, se pulsa solo). Sin «Ver
  // créditos»: todo esto existe para saltarlos.
  if (d.tipo === 'ver') {
    const lleno = sig.corriendo ? sig.progreso : 1;
    return (
      <div onMouseEnter={sig.parar}
        className="absolute bottom-28 right-6 z-10 flex animate-slide-up flex-col items-end gap-2">
        {sig.mensaje && (
          <p className="rounded bg-black/70 px-3 py-1.5 text-sm text-nf-ok">{sig.mensaje}</p>
        )}
        <div className="flex items-center gap-3">
          <button onClick={sig.confirmar} aria-label={sig.texto}
            className="relative overflow-hidden rounded bg-white/35 px-6 py-3 text-base font-semibold text-black
                       shadow-panel">
            <span className="absolute inset-y-0 left-0 bg-white"
              style={{ width: `${Math.round(lleno * 100)}%`,
                       transition: sig.corriendo ? 'width 120ms linear' : 'none' }} />
            <span className="relative flex items-center gap-2 whitespace-nowrap">
              <span className="w-5 h-5"><IconPlay /></span>
              {d.bajar.length ? sig.texto : 'Siguiente episodio'}
              <span className="font-normal text-black/60">{d.siguiente.label}</span>
            </span>
          </button>
        </div>
      </div>
    );
  }

  // Cuando ya no queda nada que ofrecer pero sí algo que contar («Descargando
  // 3x09 y 3x10»), la tarjeta se queda un momento solo con el mensaje.
  if (d.tipo === 'nada' || (d.tipo === 'bajar' && !d.bajar.length)) {
    return (
      <div className="absolute bottom-28 right-6 z-10 max-w-[calc(100vw-3rem)] animate-slide-up
                      rounded-panel border border-nf-line bg-nf-surface/95 px-4 py-3 shadow-panel">
        <p className="text-base text-nf-ok">{sig.mensaje}</p>
      </div>
    );
  }

  // Lo que queda: no hay nada descargado por delante y se ofrece bajarlo.
  // Sin barra: lo que pasa solo es seguir viendo, no gastar disco y cuota.
  return (
    <div
      className="absolute bottom-28 right-6 z-10 w-[26rem] max-w-[calc(100vw-3rem)]
                 animate-slide-up overflow-hidden rounded-panel border border-nf-line
                 bg-nf-surface/95 shadow-panel backdrop-blur"
    >
      <div className="flex items-start gap-3 p-4">
        {sig.poster && (
          <img src={sig.poster} alt="" className="h-20 w-14 shrink-0 rounded object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-micro font-semibold uppercase tracking-wide text-nf-faint">Se acaba lo descargado</p>
          <p className="mt-1 truncate text-md font-semibold">{listar(d.bajar)}</p>
          <p className="truncate text-sm text-nf-dim">{sig.titulo}</p>
        </div>
        <button onClick={sig.descartar} aria-label="Cerrar"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-nf-faint hover:bg-white/10 hover:text-white">
          <span className="w-4 h-4"><IconClose /></span>
        </button>
      </div>

      {sig.mensaje && <p className="px-4 pb-3 text-sm text-nf-ok">{sig.mensaje}</p>}

      <p className="px-4 pb-3 text-xs text-nf-faint">
        {d.bajar.map((e) => `${e.label} · ${e.size_str}`).join('  ·  ')}
      </p>

      <div className="flex items-center gap-2 px-4 pb-4">
        <Button variant="primary" size="md" className="flex-1" disabled={sig.bajando}
          icon={<IconDownload />} onClick={sig.confirmar}>
          {sig.bajando ? 'Pidiendo…' : sig.texto}
        </Button>
        <Button variant="ghost" onClick={sig.descartar}>Ahora no</Button>
      </div>
    </div>
  );
}
