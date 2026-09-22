import { useCallback } from 'react';
import { FocusScope, useFocusItem } from '../focus/react';

const ROWS = ['ABCDEF', 'GHIJKL', 'MNOPQR', 'STUVWX', 'YZÑ123', '456789', '0'];
const COLUMNS = 6;

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

function Key({ label, onPress, index, wide, autoFocus }: { label: string; onPress: () => void; index: number; wide?: boolean; autoFocus?: boolean }) {
  const { ref } = useFocusItem<HTMLDivElement>({ index, onEnter: onPress, autoFocus });
  return (
    <div ref={ref} onClick={onPress}
      className={`tv-key flex items-center justify-center rounded-lg select-none font-semibold ${wide ? 'h-[64px] px-6 text-body' : 'w-[76px] h-[64px] text-lead'}`}>
      {label}
    </div>
  );
}

/**
 * Teclado en pantalla, embebido (no modal). Rejilla de 6 columnas y una fila
 * de acciones. El IME de Tizen tapa la pantalla y devuelve el foco donde
 * quiere; con una rejilla propia el recorrido es predecible y la busqueda
 * puede ir actualizandose segun se escribe.
 */
export default function Keyboard({ value, onChange, onDone, index, autoFocus, secret, placeholder }: Props) {
  const press = useCallback((c: string) => onChange(value + c), [value, onChange]);
  const backspace = useCallback(() => onChange(value.slice(0, -1)), [value, onChange]);
  const clear = useCallback(() => onChange(''), [onChange]);
  const keys = ROWS.join('').split('');

  return (
    <FocusScope index={index} orientation="vertical" className="w-[560px]">
      <div className="mb-6 h-[72px] px-6 rounded-lg bg-black/40 border border-white/15 flex items-center overflow-hidden">
        <span className={`text-h1 font-semibold tracking-wide whitespace-nowrap ${value ? 'text-white' : 'text-tv-text3'}`}>
          {value ? (secret ? '•'.repeat(value.length) : value) : (placeholder || 'Escribe con el mando')}
        </span>
        <span className="ml-1 w-[3px] h-[44px] bg-tv-red" style={{ animation: 'fadeIn 900ms ease-in-out infinite alternate' }} />
      </div>
      <FocusScope index={0} orientation="grid" columns={COLUMNS} className="grid grid-cols-6 gap-[8px] mb-3">
        {keys.map((c, i) => <Key key={c} label={c} index={i} onPress={() => press(c)} autoFocus={autoFocus && i === 0} />)}
      </FocusScope>
      <FocusScope index={1} orientation="horizontal" className="flex gap-[8px]">
        <Key label="Espacio" index={0} wide onPress={() => press(' ')} />
        <Key label="Borrar" index={1} wide onPress={backspace} />
        <Key label="Limpiar" index={2} wide onPress={clear} />
        {onDone && <Key label="Listo" index={3} wide onPress={onDone} />}
      </FocusScope>
    </FocusScope>
  );
}
