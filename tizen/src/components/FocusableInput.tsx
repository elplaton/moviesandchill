import { useRef } from 'react';
import { setPaused } from '../focus/engine';
import { useFocusItem } from '../focus/react';

interface FocusableInputProps {
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
  focusKey?: string;
  index?: number;
}

/**
 * Campo de texto para mando. Enter entrega el foco real al <input>, que es lo
 * que abre el teclado en pantalla de Tizen. Mientras se escribe se pausa la
 * navegacion para que las flechas muevan el cursor del texto y no el foco.
 */
export default function FocusableInput({
  type = 'text', value, onChange, placeholder, label, focusKey, index,
}: FocusableInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const { ref } = useFocusItem<HTMLDivElement>({
    focusKey,
    index,
    onEnter: () => inputRef.current?.focus(),
    onBlur: () => inputRef.current?.blur(),
  });

  return (
    <div ref={ref} className="tv-focusable relative mb-5 rounded-xl">
      <input
        ref={inputRef}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        placeholder={placeholder || ' '}
        className="peer w-full bg-white/10 rounded-xl px-4 pt-6 pb-2.5 text-white text-sm outline-none border border-white/10 focus:border-white/30"
      />
      <label className="absolute left-4 top-2 text-gray-500 text-xs peer-placeholder-shown:top-4 peer-placeholder-shown:text-sm peer-focus:top-2 peer-focus:text-xs pointer-events-none">
        {label}
      </label>
    </div>
  );
}
