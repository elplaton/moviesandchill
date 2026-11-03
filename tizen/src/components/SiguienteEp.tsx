import { listar } from '../services/siguiente';
import { soloPuntero } from '../tv/platform';
import type { EstadoSiguiente } from '../hooks/useSiguiente';
import { IconPlay } from './Icons';

const PUNTERO = soloPuntero();

export interface OpcionSig {
  clave: 'hacer' | 'cerrar';
  texto: string;
  principal?: boolean;
  onSelect: () => void;
}

/**
 * Los botones de la tarjeta, en el orden en que los recorre el mando.
 *
 * Son dos: **la acción** y cerrar. Ver el siguiente y dejar bajando el de
 * después eran dos botones y ahora son uno solo, porque en ese momento nadie
 * está eligiendo entre dos cosas: está diciendo «sigue».
 *
 * La lista vive aquí y no dentro del componente porque el reproductor necesita
 * la **misma** para dos cosas: dibujarla y saber qué hacer cuando se pulsa OK.
 * Con la lista en dos sitios, mover un botón cambiaba lo que hacía otro.
 */
export function opcionesSiguiente(sig: EstadoSiguiente): OpcionSig[] {
  const d = sig.decision;
  // La pantalla del final lleva su propio mando (FinTitulo).
  if (d.tipo === 'nada' || d.tipo === 'final' || (d.tipo === 'bajar' && !d.bajar.length)) return [];
  if (d.tipo === 'ver') {
    return [
      { clave: 'hacer', principal: true, onSelect: sig.confirmar,
        texto: d.bajar.length ? sig.texto : `Siguiente episodio · ${d.siguiente.label}` },
      { clave: 'cerrar', texto: 'Ver créditos', onSelect: sig.descartar },
    ];
  }
  return [
    { clave: 'hacer', texto: sig.texto, principal: true, onSelect: sig.confirmar },
    { clave: 'cerrar', texto: 'Ahora no', onSelect: sig.descartar },
  ];
}

interface Props {
  sig: EstadoSiguiente;
  /** Qué botón está enfocado. Lo lleva el reproductor, que es quien se queda
   *  con todas las teclas mientras hay vídeo. */
  cursor: number;
  /** Si el mando está dentro de la tarjeta. Mientras el capítulo corre no lo
   *  está (las flechas son el salto de 10 s), y entonces no se pinta ningún
   *  botón enfocado: se dice cómo entrar. */
  enfocada: boolean;
  opciones: OpcionSig[];
}

/**
 * La tarjeta del final de un capítulo, en la tele.
 *
 * Va abajo a la derecha, encima de la barra de controles: los créditos se
 * siguen viendo detrás, y en una pantalla de 1920 hay sitio de sobra para no
 * tapar nada. El foco no usa el motor de `focus/` porque el reproductor ya se
 * queda con todas las teclas mientras hay vídeo (igual que el panel de idioma
 * y subtítulos): lo que hay es un cursor y una clase CSS, que es la regla de
 * render de esta app.
 *
 * En la PlayStation no llega ninguna tecla, así que los botones se pulsan con
 * el cursor; es el mismo `soloPuntero()` que enciende los demás botones
 * dibujados del reproductor.
 */
export default function SiguienteEp({ sig, cursor, enfocada, opciones }: Props) {
  const d = sig.decision;

  // Cuando ya no queda nada que ofrecer pero sí algo que contar («Descargando
  // 3x09 y 3x10»), queda solo el mensaje. Los dos casos van por separado y no
  // en un `if` combinado para que TypeScript pueda descartar el 'nada' de ahí
  // en adelante.
  const soloMensaje = (
    <div className="absolute right-[96px] bottom-[300px] w-[760px] rounded-2xl bg-[#1A1A1A]/95 border border-white/15 px-10 py-7">
      <p className="text-lead text-tv-ok">{sig.mensaje}</p>
    </div>
  );
  if (d.tipo === 'final') return null;
  if (d.tipo === 'nada') return sig.mensaje ? soloMensaje : null;
  if (!opciones.length) return soloMensaje;

  const pct = Math.round(sig.progreso * 100);

  return (
    <div className="absolute right-[96px] bottom-[300px] w-[760px] rounded-2xl bg-[#1A1A1A]/95 border border-white/15 overflow-hidden">
      {/* La barra de la cuenta atrás, al ancho completo y arriba: es la señal
          que se entiende desde el sofá sin leer nada, y es este mismo botón
          pulsándose solo. */}

      <div className="px-10 pt-8 pb-9">
        <div className="flex items-start space-x-6">
          {sig.poster && (
            <img src={sig.poster} alt="" className="w-[120px] h-[180px] rounded-lg object-cover shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-caption uppercase tracking-wide text-tv-text3">
              {d.tipo === 'ver' ? 'A continuación' : 'Se acaba lo descargado'}
            </p>
            <p className="mt-2 text-h1 font-bold truncate">
              {d.tipo === 'ver' ? d.siguiente.label : listar(d.bajar)}
            </p>
            {sig.titulo && <p className="mt-1 text-lead text-tv-text2 truncate">{sig.titulo}</p>}
            {d.tipo === 'bajar' && (
              <p className="mt-3 text-body text-tv-text3">
                {d.bajar.map((e) => `${e.label} · ${e.size_str}`).join('   ·   ')}
              </p>
            )}
            {sig.mensaje && <p className="mt-3 text-body text-tv-ok">{sig.mensaje}</p>}
          </div>
        </div>

        <div className="mt-8 flex items-center space-x-4">
          {opciones.map((op, i) => (
            <button key={op.clave}
              onMouseEnter={PUNTERO ? sig.parar : undefined}
              onClick={PUNTERO ? op.onSelect : undefined}
              disabled={op.clave === 'hacer' && sig.bajando}
              className={`relative overflow-hidden inline-flex items-center justify-center space-x-3 rounded-lg px-8 h-[64px]
                text-body font-semibold whitespace-nowrap
                ${op.clave === 'hacer' && d.tipo === 'ver'
                  ? `text-black ${enfocada && i === cursor ? 'bg-white/60 ring-4 ring-white' : 'bg-white/35'}`
                  : enfocada && i === cursor ? 'bg-white text-black'
                  : op.principal ? 'bg-tv-red text-white' : 'bg-white/15 text-white'}
                ${PUNTERO ? ' cursor-pointer' : ''}`}>
              {/* Ver el siguiente: el boton se va llenando (la cuenta atras) y,
                  al llenarse, se pulsa solo. Escala por transform, que es lo
                  unico que se anima en la tele. */}
              {op.clave === 'hacer' && d.tipo === 'ver' && (
                <span className="absolute inset-0 bg-white origin-left"
                  style={{ transform: `scaleX(${sig.corriendo ? pct / 100 : 1})`,
                           transition: sig.corriendo ? 'transform 120ms linear' : 'none' }} />
              )}
              {op.clave === 'hacer' && d.tipo === 'ver' && <span className="relative w-7 h-7"><IconPlay /></span>}
              <span className="relative">
                {op.clave === 'hacer' && sig.bajando && d.tipo === 'bajar' ? 'Pidiendo…'
                  : op.texto}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-6 text-caption text-tv-text3">
          {PUNTERO ? 'Pulsa una opción'
            : enfocada ? '◀ ▶ eligen · OK confirma · Atrás cierra'
            : '▼ para elegir'}
        </p>
      </div>
    </div>
  );
}
