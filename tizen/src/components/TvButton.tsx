import { type ReactNode } from 'react';
import { useFocusItem } from '../focus/react';

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
  const { ref } = useFocusItem<HTMLButtonElement>({
    focusKey, index, disabled, autoFocus,
    onEnter: () => onClick?.(),
  });
  return (
    <button
      ref={ref}
      onClick={onClick}
      disabled={disabled}
      className={`tv-btn ${primary ? 'tv-btn-primary' : ''} inline-flex items-center gap-3 rounded-lg px-7 h-[60px] text-body font-semibold whitespace-nowrap ${disabled ? 'opacity-40' : ''} ${className || ''}`}
    >
      {icon && <span className="w-7 h-7 shrink-0 flex items-center justify-center">{icon}</span>}
      {children}
    </button>
  );
}
