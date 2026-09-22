import { useCallback, useState } from 'react';
import { FocusScope, useFocusItem } from '../focus/react';
import { applyFocus } from '../focus/engine';

const COLUMNS = 6;
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZÑ0123456789'.split('');
const LOWER = UPPER.map((c) => c.toLowerCase());
const SYMBOLS = '.,-_@!?#$%&*+=/:;()[]{}<>\'"~^|\\€ºª¿¡'.split('');

type Mode = 'upper' | 'lower' | 'symbols';

interface Props {
  value: string;
  onChange: (next: string) => void;
  /** OK sobre "Listo". */
  onDone?: () => void;
  index?: number;
  autoFocus?: boolean;
  /** Oculta lo escrito (contraseñas). */
  secret?: boolean;
  placeholder?: string;
}

function Key({ label, onPress, index, wide, autoFocus, active }: {
  label: string; onPress: () => void; index: number; wide?: boolean; autoFocus?: boolean; active?: boolean;
}) {
  const { ref, focusKey: id } = useFocusItem<HTMLDivElement>({ index, onEnter: onPress, autoFocus });
  return (
    <div ref={ref} onClick={onPress} onMouseEnter={() => applyFocus(id)}
      className={`tv-key flex items-center justify-center rounded-lg select-none font-semibold ${wide ? 'h-[64px] px-5 text-body' : 'w-[76px] h-[64px] text-lead'} ${active ? 'ring-2 ring-tv-red' : ''}`}>
      {label}
    </div>
  );
}

/**
 * Teclado en pantalla, embebido (no modal). Rejilla de 6 columnas con tres
 * paginas (mayusculas, minusculas y simbolos) y una fila de acciones. El IME
 * de Tizen tapa la pantalla y devuelve el foco donde quiere; con una rejilla
 * propia el recorrido es predecible y la busqueda se actualiza segun se
 * escribe.
 */
export default function Keyboard({ value, onChange, onDone, index, autoFocus, secret, placeholder }: Props) {
  const [mode, setMode] = useState<Mode>('upper');
  const press = useCallback((c: string) => onChange(value + c), [value, onChange]);
  const backspace = useCallback(() => onChange(value.slice(0, -1)), [value, onChange]);
  const clear = useCallback(() => onChange(''), [onChange]);
  const keys = mode === 'upper' ? UPPER : mode === 'lower' ? LOWER : SYMBOLS;

  return (
    <FocusScope index={index} orientation="vertical" className="w-[560px]">
      <div className="mb-6 h-[72px] px-6 rounded-lg bg-black/40 border border-white/15 flex items-center overflow-hidden">
        <span className={`text-h1 font-semibold tracking-wide whitespace-nowrap ${value ? 'text-white' : 'text-tv-text3'}`}>
          {value ? (secret ? '•'.repeat(value.length) : value) : (placeholder || 'Escribe con el mando')}
        </span>
        <span className="ml-1 w-[3px] h-[44px] bg-tv-red" style={{ animation: 'fadeIn 900ms ease-in-out infinite alternate' }} />
      </div>
      {/* La rejilla conserva el id entre paginas para que el foco no salte al cambiar de mayusculas a minusculas. */}
      <FocusScope index={0} orientation="grid" columns={COLUMNS} className="grid grid-cols-6 gap-[8px] mb-3">
        {keys.map((c, i) => <Key key={i} label={c} index={i} onPress={() => press(c)} autoFocus={autoFocus && i === 0} />)}
      </FocusScope>
      <FocusScope index={1} orientation="horizontal" className="flex space-x-[8px] mb-[8px]">
        <Key label="ABC" index={0} wide active={mode === 'upper'} onPress={() => setMode('upper')} />
        <Key label="abc" index={1} wide active={mode === 'lower'} onPress={() => setMode('lower')} />
        <Key label="#+=" index={2} wide active={mode === 'symbols'} onPress={() => setMode('symbols')} />
        <Key label="Espacio" index={3} wide onPress={() => press(' ')} />
      </FocusScope>
      <FocusScope index={2} orientation="horizontal" className="flex space-x-[8px]">
        <Key label="Borrar" index={0} wide onPress={backspace} />
        <Key label="Limpiar" index={1} wide onPress={clear} />
        {onDone && <Key label="Listo" index={2} wide onPress={onDone} />}
      </FocusScope>
    </FocusScope>
  );
}
