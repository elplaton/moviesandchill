import type { ReactNode } from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';

interface FocusableButtonProps {
  onClick?: () => void;
  className?: string;
  children: ReactNode;
  focusKey?: string;
}

export default function FocusableButton({ onClick, className, children, focusKey }: FocusableButtonProps) {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: () => onClick?.(),
  });

  return (
    <button
      ref={ref}
      onClick={onClick}
      className={className}
      style={{
        outline: focused ? '3px solid #E50914' : 'none',
        outlineOffset: '2px',
      }}
    >
      {children}
    </button>
  );
}
