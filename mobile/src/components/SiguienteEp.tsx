import { IDown, IPlay } from './Icons';
import { listar } from '../services/siguiente';
import type { EstadoSiguiente } from '../hooks/useSiguiente';

/**
 * La tarjeta del final de un capítulo, en el teléfono.
 *
 * Va **encima del vídeo**, abajo, sin tapar la imagen entera: los créditos se
 * siguen viendo detrás, igual que en la web y en la tele. Eso solo es posible
 * desde que el reproductor dejó de entrar en la pantalla completa del sistema
 * (ver `Player`), porque ahí no se puede dibujar nada encima.
 *
 * **Un solo botón**, y la barra de arriba es ese botón pulsándose solo. Por
 * eso el texto dice lo que va a pasar («Ver 3x08 y descargar 3x09») en vez de
 * un «Siguiente» genérico. La tarjeta de descargar a secas no lleva barra: lo
 * que puede pasar sin que nadie toque nada es seguir viendo, no gastar disco.
 *
 * El botón es alto (52 px) porque esto se pulsa con el pulgar y a oscuras, que
 * es la situación real: capítulo terminado, de noche, en la cama. Y se deja
 * sitio abajo (`pb-24`) para no caer justo encima de la barra de controles del
 * vídeo, que es lo que se pulsaría sin querer.
 */
export default function SiguienteEp({ sig }: { sig: EstadoSiguiente }) {
  const d = sig.decision;
  if (d.tipo === 'nada' && !sig.mensaje) return null;

  // Cuando ya no queda nada que ofrecer pero sí algo que contar («Descargando
  // 3x09 y 3x10»), queda solo el mensaje.
  if (d.tipo === 'nada' || (d.tipo === 'bajar' && !d.bajar.length)) {
    return (
      <div className="absolute inset-x-0 bottom-0 z-10 px-4 pb-24 pointer-events-none">
        <div className="rounded-2xl bg-black/85 px-4 py-3">
          <p className="text-[14px] text-nf-ok">{sig.mensaje}</p>
        </div>
      </div>
    );
  }

  const pct = Math.round(sig.progreso * 100);

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 px-4 pb-24" onTouchStart={sig.parar}>
      <div className="overflow-hidden rounded-2xl bg-black/85 backdrop-blur">
        {d.tipo === 'ver' && (
          <div className="h-1 w-full bg-white/20">
            <div className="h-full bg-nf-red"
              style={{ width: `${pct}%`, transition: sig.corriendo ? 'width 120ms linear' : 'none' }} />
          </div>
        )}

        <div className="flex items-center gap-3 px-4 pt-3">
          {sig.poster && (
            <img src={sig.poster} alt="" className="h-16 w-11 shrink-0 rounded object-cover" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-nf-text3">
              {d.tipo === 'ver' ? 'A continuación' : 'Se acaba lo descargado'}
            </p>
            <p className="truncate text-[17px] font-bold leading-tight">
              {d.tipo === 'ver' ? d.siguiente.label : listar(d.bajar)}
            </p>
            {sig.titulo && <p className="truncate text-[13px] text-nf-text2">{sig.titulo}</p>}
          </div>
        </div>

        {sig.mensaje && <p className="px-4 pt-2 text-[13px] text-nf-ok">{sig.mensaje}</p>}

        {d.tipo === 'bajar' && (
          <p className="px-4 pt-2 text-[12px] text-nf-text3">
            {d.bajar.map((e) => `${e.label} · ${e.size_str}`).join('   ·   ')}
          </p>
        )}

        <div className="flex items-center gap-2 p-4">
          <button onClick={sig.confirmar} disabled={sig.bajando}
            className={`flex h-[52px] min-w-0 flex-1 items-center justify-center gap-2 rounded-xl
              text-[15px] font-semibold disabled:opacity-40
              ${d.tipo === 'ver' ? 'bg-white text-black active:bg-white/85'
                                 : 'bg-nf-red active:bg-nf-reddeep'}`}>
            <span className="w-5 h-5 shrink-0">{d.tipo === 'ver' ? <IPlay /> : <IDown />}</span>
            <span className="truncate">
              {sig.bajando && d.tipo === 'bajar' ? 'Pidiendo…'
                : sig.corriendo ? `${sig.texto} · ${sig.restante}`
                : sig.texto}
            </span>
          </button>
          <button onClick={sig.descartar}
            className="h-[52px] shrink-0 rounded-xl px-4 text-[15px] font-semibold text-nf-text2 active:bg-white/10">
            {d.tipo === 'ver' ? 'No' : 'Ahora no'}
          </button>
        </div>
      </div>
    </div>
  );
}
