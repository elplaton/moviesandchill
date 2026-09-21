import { useCallback } from 'react';
import { FocusScope, useBackHandler, useFocusItem } from '../focus/react';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
const COLUMNS = 6;

interface Props {
  value: string;
  onChange: (next: string) => void;
  onClose: () => void;
}

function Key({ label, onPress, index, wide }: {
  label: string; onPress: () => void; index: number; wide?: boolean;
}) {
  const { ref } = useFocusItem<HTMLDivElement>({
    index,
    onEnter: onPress,
    autoFocus: index === 0,
  });
  return (
    <div
      ref={ref}
      onClick={onPress}
      className={`tv-focusable flex items-center justify-center rounded-lg bg-white/10 text-white cursor-pointer select-none ${
        wide ? 'px-5 py-3 text-sm' : 'h-12 text-lg font-medium'
      }`}
    >
      {label}
    </div>
  );
}

/**
 * Teclado en pantalla para el mando.
 *
 * El IME de Tizen obliga a navegar un teclado del sistema que tapa la pantalla
 * y devuelve el foco donde quiere. Con una rejilla propia el recorrido es
 * predecible y la busqueda puede ir actualizandose segun se escribe.
 */
export default function OnScreenKeyboard({ value, onChange, onClose }: Props) {
  useBackHandler(() => { onClose(); }, true);

  const press = useCallback((char: string) => { onChange(value + char); }, [value, onChange]);
  const backspace = useCallback(() => { onChange(value.slice(0, -1)); }, [value, onChange]);
  const clear = useCallback(() => { onChange(''); }, [onChange]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">
      <FocusScope orientation="vertical" trap className="w-[520px] max-w-[90vw]">
        <div className="bg-netflix-card border border-white/10 rounded-2xl p-6 shadow-2xl">
          <div className="mb-5 px-4 py-3 rounded-xl bg-black/50 border border-white/10 min-h-[48px] flex items-center">
            <span className="text-white text-lg break-all">
              {value || <span className="text-gray-500">Escribe para buscar</span>}
            </span>
          </div>

          <FocusScope orientation="grid" columns={COLUMNS} index={0}>
            <div className="grid grid-cols-6 gap-2 mb-3">
              {LETTERS.map((char, i) => (
                <Key key={char} label={char} index={i} onPress={() => press(char)} />
              ))}
            </div>
          </FocusScope>

          <FocusScope orientation="horizontal" index={1}>
            <div className="flex gap-2">
              <Key label="Espacio" index={0} wide onPress={() => press(' ')} />
              <Key label="Borrar" index={1} wide onPress={backspace} />
              <Key label="Limpiar" index={2} wide onPress={clear} />
              <Key label="Cerrar" index={3} wide onPress={onClose} />
            </div>
          </FocusScope>
        </div>
      </FocusScope>
    </div>
  );
}
