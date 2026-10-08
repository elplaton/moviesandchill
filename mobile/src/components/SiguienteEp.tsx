import { IDown, IPlay } from './Icons';
import { listar } from '../services/siguiente';
import type { EstadoSiguiente } from '../hooks/useSiguiente';

/**
 * La tarjeta del final de un capítulo, en el teléfono.
 *
 * Ocupa la pantalla entera y no una esquina, al contrario que en la web, y es
 * por una razón concreta: aquí el vídeo se reproduce con el reproductor del
 * sistema, así que cuando esta tarjeta aparece **ya se ha salido de la
 * pantalla completa** y detrás no hay nada que tapar. Lo que se ve es el
 * último fotograma congelado, que no es una imagen que merezca respetarse.
 *
 * Dos formas:
 *
 *   «A continuación»  el siguiente episodio está en disco: botón grande y la
 *                     barra que avanza sola, que al llenarse lo pone.
 *   «Descargar»       no queda nada descargado por delante. Sin barra: lo que
 *                     avanza solo puede ser ver algo, nunca gastar disco.
 *
 * Los botones son altos (52 px) porque esto se pulsa con el pulgar y a
 * oscuras, que es la situación real: capítulo terminado, de noche, en la cama.
 */
export default function SiguienteEp({ sig }: { sig: EstadoSiguiente }) {
  const d = sig.decision;
  if (d.tipo === 'nada') return null;

  const pct = Math.round(sig.progreso * 100);

  return (
    <div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/80" onTouchStart={sig.parar}>
      {sig.backdrop && (
        <img src={sig.backdrop} alt="" className="absolute inset-0 w-full h-full object-cover opacity-20" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/85 to-black/40" />

      <div className="relative px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-8">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-nf-text3">
          {d.tipo === 'ver' ? 'A continuación' : 'Se acaba lo descargado'}
        </p>
        <p className="mt-1 text-[22px] font-bold leading-tight">
          {d.tipo === 'ver' ? d.siguiente.label : listar(d.bajar)}
        </p>
        {sig.titulo && <p className="mt-0.5 text-[15px] text-nf-text2">{sig.titulo}</p>}

        {d.tipo === 'ver' && (
          <div className="mt-5 h-1 w-full overflow-hidden rounded-full bg-white/20">
            <div className="h-full rounded-full bg-nf-red"
              style={{ width: `${pct}%`, transition: sig.corriendo ? 'width 120ms linear' : 'none' }} />
          </div>
        )}

        {sig.mensaje && <p className="mt-4 text-[14px] text-nf-ok">{sig.mensaje}</p>}

        {d.tipo === 'bajar' && (
          <p className="mt-3 text-[13px] text-nf-text3">
            {d.bajar.map((e) => `${e.label} · ${e.size_str}`).join('   ·   ')}
          </p>
        )}

        <div className="mt-6 space-y-3">
          {d.tipo === 'ver' ? (
            <>
              <button onClick={sig.ver}
                className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-white text-[16px] font-semibold text-black active:bg-white/85">
                <span className="w-5 h-5"><IPlay /></span>
                {sig.corriendo ? `Ver ahora · ${sig.restante}` : 'Ver ahora'}
              </button>
              {d.bajar.length > 0 && (
                <button onClick={sig.descargar} disabled={sig.bajando}
                  className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-white/15 text-[16px] font-semibold active:bg-white/25 disabled:opacity-40">
                  <span className="w-5 h-5"><IDown /></span>
                  {sig.bajando ? 'Pidiendo…' : `Descargar ${listar(d.bajar)}`}
                </button>
              )}
            </>
          ) : (
            <button onClick={sig.descargar} disabled={sig.bajando}
              className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-nf-red text-[16px] font-semibold active:bg-nf-reddeep disabled:opacity-40">
              <span className="w-5 h-5"><IDown /></span>
              {sig.bajando ? 'Pidiendo…'
                : `Descargar ${d.bajar.length > 1 ? 'los dos siguientes' : 'el siguiente'}`}
            </button>
          )}
          <button onClick={sig.descartar}
            className="h-[52px] w-full rounded-xl text-[16px] font-semibold text-nf-text2 active:bg-white/10">
            {d.tipo === 'ver' ? 'Salir' : 'Ahora no'}
          </button>
        </div>
      </div>
    </div>
  );
}
