import { type ReactNode } from 'react';
import { useFocusItem } from '../focus/react';

interface FocusableButtonProps {
  onClick?: () => void;
  className?: string;
  children: ReactNode;
  focusKey?: string;
  index?: number;
  disabled?: boolean;
  autoFocus?: boolean;
}

/**
 * El estado de foco no pasa por React: el motor pone la clase `is-focused` en
 * el nodo y el aro rojo lo dibuja el CSS (.tv-focusable.is-focused).
 */
export default function FocusableButton({
  onClick, className, children, focusKey, index, disabled, autoFocus,
}: FocusableButtonProps) {
  const { ref } = useFocusItem<HTMLButtonElement>({
    focusKey, index, disabled, autoFocus,
    onEnter: () => onClick?.(),
  });

  return (
    <button
      ref={ref}
      onClick={onClick}
      disabled={disabled}
      className={`tv-focusable ${className || ''}`}
    >
      {children}
    </button>
  );
}
