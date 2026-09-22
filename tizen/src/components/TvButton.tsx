import { type ReactNode } from 'react';
import { useFocusItem } from '../focus/react';
import { applyFocus } from '../focus/engine';

interface Props {
  onClick?: () => void;
  children: ReactNode;
  focusKey?: string;
  index?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  primary?: boolean;
  className?: string;
  icon?: ReactNode;
}

/** Boton de television: grande, gris en reposo y blanco lleno al enfocar. */
export default function TvButton({
  onClick, children, focusKey, index, disabled, autoFocus, primary, className, icon,
}: Props) {
  const { ref, focusKey: id } = useFocusItem<HTMLButtonElement>({
    focusKey, index, disabled, autoFocus,
    onEnter: () => onClick?.(),
  });
  return (
    <button
      ref={ref}
      onClick={onClick}
      onMouseEnter={() => { if (!disabled) applyFocus(id); }}
      disabled={disabled}
      className={`tv-btn ${primary ? 'tv-btn-primary' : ''} inline-flex items-center space-x-3 rounded-lg px-7 h-[60px] text-body font-semibold whitespace-nowrap ${disabled ? 'opacity-40' : ''} ${className || ''}`}
    >
      {icon && <span className="w-7 h-7 shrink-0 flex items-center justify-center">{icon}</span>}
      <span>{children}</span>
    </button>
  );
}
