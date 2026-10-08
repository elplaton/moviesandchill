import Button from './ui/Button';
import { IconClose, IconPlay } from './ui/Icon';
import { listar } from '../services/siguiente';
import type { EstadoSiguiente } from '../hooks/useSiguiente';

/**
 * La tarjeta del final de un capítulo, abajo a la derecha del reproductor.
 *
 * Dos formas, y la decide `useSiguiente`:
 *
 *   «Siguiente episodio»  cuando el que viene ya está en disco. Lleva la barra
 *                         que avanza sola y pasa al siguiente al llenarse, y
 *                         un segundo botón para dejar bajando el de después
 *                         si delante solo quedaba ése.
 *   «Descargar»           cuando por delante no hay nada descargado. Sin barra
 *                         a propósito: lo que avanza solo puede ser *ver* algo,
 *                         nunca gastar disco y cuota de alguien.
 *
 * Va en una esquina y no en el centro porque los créditos se siguen viendo
 * detrás: tapar la pantalla entera para preguntar algo que se puede ignorar
 * es lo que hace que la gente busque cómo desactivarlo.
 */
export default function NextUp({ sig }: { sig: EstadoSiguiente }) {
  const d = sig.decision;
  if (d.tipo === 'nada') return null;

  const pendiente = d.bajar.length > 0;

  return (
    <div
      onMouseEnter={sig.parar}
      className="absolute bottom-28 right-6 z-10 w-[26rem] max-w-[calc(100vw-3rem)]
                 animate-slide-up overflow-hidden rounded-panel border border-nf-line
                 bg-nf-surface/95 shadow-panel backdrop-blur"
    >
      {/* La barra de la cuenta atrás va arriba y al ancho completo: es la
          misma señal que usa Netflix y se entiende sin leer nada. */}
      {d.tipo === 'ver' && (
        <div className="h-1 w-full bg-white/15">
          <div
            className="h-full bg-nf-red"
            style={{ width: `${Math.round(sig.progreso * 100)}%`,
                     transition: sig.corriendo ? 'width 120ms linear' : 'none' }}
          />
        </div>
      )}

      <div className="flex items-start gap-3 p-4">
        {sig.poster && (
          <img src={sig.poster} alt="" className="h-20 w-14 shrink-0 rounded object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-micro font-semibold uppercase tracking-wide text-nf-faint">
            {d.tipo === 'ver' ? 'A continuación' : 'Se acaba lo descargado'}
          </p>
          <p className="mt-1 truncate text-md font-semibold">
            {d.tipo === 'ver' ? d.siguiente.label : listar(d.bajar)}
          </p>
          <p className="truncate text-sm text-nf-dim">{sig.titulo}</p>
        </div>
        <button onClick={sig.descartar} aria-label="Cerrar"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-nf-faint hover:bg-white/10 hover:text-white">
          <span className="w-4 h-4"><IconClose /></span>
        </button>
      </div>

      {sig.mensaje && (
        <p className="px-4 pb-3 text-sm text-nf-ok">{sig.mensaje}</p>
      )}

      <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
        {d.tipo === 'ver' ? (
          <>
            <Button variant="light" icon={<IconPlay />} onClick={sig.ver}>
              {sig.corriendo ? `Ver ahora (${sig.restante})` : 'Ver ahora'}
            </Button>
            {pendiente && (
              <Button variant="ghost" onClick={sig.descargar} disabled={sig.bajando}>
                {sig.bajando ? 'Pidiendo…' : `Descargar ${listar(d.bajar)}`}
              </Button>
            )}
          </>
        ) : (
          <>
            <Button variant="primary" onClick={sig.descargar} disabled={sig.bajando}>
              {sig.bajando ? 'Pidiendo…' : `Descargar ${d.bajar.length > 1 ? 'los dos siguientes' : 'el siguiente'}`}
            </Button>
            <Button variant="ghost" onClick={sig.descartar}>Ahora no</Button>
          </>
        )}
      </div>

      {d.tipo === 'bajar' && (
        <p className="px-4 pb-4 -mt-2 text-xs text-nf-faint">
          {d.bajar.map((e) => `${e.label} · ${e.size_str}`).join('  ·  ')}
        </p>
      )}
    </div>
  );
}
